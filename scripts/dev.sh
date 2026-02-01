#!/bin/bash

# StockClerk Development Script
# Starts all services for local development

set -e

echo "============================================="
echo "  StockClerk - Development Mode"
echo "============================================="
echo ""

# Navigate to project root
cd "$(dirname "$0")/.."
PROJECT_ROOT=$(pwd)

echo "Project root: $PROJECT_ROOT"
echo ""

# Load environment variables
if [ -f ".env" ]; then
    export $(cat .env | grep -v '^#' | xargs)
    echo "Loaded environment from .env"
else
    echo "Warning: .env file not found. Run ./scripts/setup.sh first."
fi
echo ""

# Function to check if a port is in use
check_port() {
    if command -v lsof &> /dev/null; then
        lsof -i :$1 > /dev/null 2>&1
        return $?
    elif command -v netstat &> /dev/null; then
        netstat -tuln | grep -q ":$1 "
        return $?
    else
        return 1
    fi
}

# Check if Docker services are running
echo "Checking services..."

# Check PostgreSQL
if check_port 5432; then
    echo "  PostgreSQL: Running on port 5432"
else
    echo "  PostgreSQL: Not running"
    echo "    Start with: docker-compose -f docker/docker-compose.yml up -d postgres"
    echo "    Or ensure PostgreSQL is installed and running"
fi

# Check Redis
if check_port 6379; then
    echo "  Redis: Running on port 6379"
else
    echo "  Redis: Not running"
    echo "    Start with: docker-compose -f docker/docker-compose.yml up -d redis"
    echo "    Or ensure Redis is installed and running"
fi
echo ""

# Start services using concurrently or in background
echo "Starting development servers..."
echo ""

# Check if concurrently is installed
if command -v npx &> /dev/null && npx concurrently --version &> /dev/null 2>&1; then
    # Use concurrently for nicer output
    npx concurrently \
        --names "backend,frontend" \
        --prefix-colors "blue,green" \
        --kill-others-on-fail \
        "cd packages/backend && pnpm dev" \
        "cd packages/frontend && pnpm dev"
else
    # Fallback to running in background
    echo "Starting Backend on http://localhost:3001 ..."
    cd packages/backend && pnpm dev &
    BACKEND_PID=$!
    cd ../..

    echo "Starting Frontend on http://localhost:5173 ..."
    cd packages/frontend && pnpm dev &
    FRONTEND_PID=$!
    cd ../..

    echo ""
    echo "============================================="
    echo "  Servers Started!"
    echo "============================================="
    echo ""
    echo "  Frontend: http://localhost:5173"
    echo "  Backend:  http://localhost:3001"
    echo "  API:      http://localhost:3001/api"
    echo "  WebSocket: ws://localhost:3001/ws"
    echo ""
    echo "Press Ctrl+C to stop all servers"
    echo ""

    # Trap to kill background processes on exit
    trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT

    # Wait for processes
    wait
fi
