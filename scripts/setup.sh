#!/bin/bash

# StockClerk Setup Script
# Initializes the development environment

set -e

echo "============================================="
echo "  StockClerk - Development Setup"
echo "============================================="
echo ""

# Check for required tools
echo "Checking prerequisites..."

if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    exit 1
fi

if ! command -v pnpm &> /dev/null; then
    echo "Installing pnpm..."
    npm install -g pnpm
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "Error: Node.js version 18 or higher is required"
    exit 1
fi

echo "  - Node.js: $(node -v)"
echo "  - pnpm: $(pnpm -v)"
echo ""

# Navigate to project root
cd "$(dirname "$0")/.."
PROJECT_ROOT=$(pwd)

echo "Project root: $PROJECT_ROOT"
echo ""

# Install dependencies
echo "Installing dependencies..."
pnpm install
echo ""

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "Creating .env file from .env.example..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
    else
        cat > .env << 'EOF'
# Database Configuration
DATABASE_URL=postgresql://stockclerk:stockclerk_dev@localhost:5432/stockclerk

# Redis Configuration
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=stockclerk-development-secret-key-32chars
JWT_EXPIRES_IN=7d

# Server Configuration
NODE_ENV=development
PORT=3001
HOST=0.0.0.0

# CORS Configuration
CORS_ORIGIN=http://localhost:5173,http://localhost:3000

# Encryption Key (32 characters for AES-256)
ENCRYPTION_KEY=stockclerk-encryption-key-32char

# Frontend URL
FRONTEND_URL=http://localhost:5173
EOF
    fi
    echo "  Created .env file"
else
    echo "  .env file already exists"
fi
echo ""

# Check if Docker is available for database/redis
if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
    echo "Docker found. Starting services..."

    # Check if docker-compose file exists
    if [ -f "docker/docker-compose.yml" ]; then
        cd docker
        docker-compose up -d postgres redis
        cd ..
        echo "  Started PostgreSQL and Redis containers"

        # Wait for database to be ready
        echo "  Waiting for database to be ready..."
        sleep 5
    fi
else
    echo "Docker not found. Please ensure PostgreSQL and Redis are running manually."
    echo "  - PostgreSQL: postgresql://stockclerk:stockclerk_dev@localhost:5432/stockclerk"
    echo "  - Redis: redis://localhost:6379"
fi
echo ""

# Build packages
echo "Building packages..."
pnpm run build 2>/dev/null || echo "  Build step skipped (may need TypeScript setup)"
echo ""

# Run database migrations
echo "Running database migrations..."
cd packages/backend
if command -v npx &> /dev/null; then
    npx drizzle-kit push 2>/dev/null || echo "  Migrations skipped (database may not be ready)"
fi
cd ../..
echo ""

# Seed database
echo "Seeding database with demo data..."
cd packages/backend
pnpm run db:seed 2>/dev/null || echo "  Seeding skipped (database may not be ready)"
cd ../..
echo ""

echo "============================================="
echo "  Setup Complete!"
echo "============================================="
echo ""
echo "To start the development servers, run:"
echo "  ./scripts/dev.sh"
echo ""
echo "Or start individually:"
echo "  pnpm --filter @stockclerk/backend dev        # Backend on :3001"
echo "  pnpm --filter @stockclerk/frontend dev       # Frontend on :5173"
echo ""
echo "Demo credentials:"
echo "  Email: demo@stockclerk.local"
echo "  Password: password123"
echo ""
