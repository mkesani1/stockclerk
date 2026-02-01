# StockClerk

Real-time inventory synchronisation platform that connects EposNow, Wix, and Otter systems.

## Quick Start

### Prerequisites

- Node.js 20+
- npm 10+
- Docker and Docker Compose

### Setup

1. **Clone and install dependencies:**
   ```bash
   cd stockclerk
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start infrastructure services:**
   ```bash
   npm run docker:up
   ```

4. **Run database migrations:**
   ```bash
   npm run db:migrate
   ```

5. **Start development servers:**
   ```bash
   npm run dev
   ```

## Project Structure

```
stockclerk/
├── packages/
│   ├── backend/          # Express.js API server
│   ├── frontend/         # React dashboard
│   ├── integrations/     # Third-party API connectors
│   └── sync-engine/      # Real-time sync logic
├── docker/
│   ├── docker-compose.yml
│   ├── Dockerfile.backend
│   ├── Dockerfile.frontend
│   └── nginx.conf
├── .github/
│   └── workflows/
│       └── ci.yml
├── package.json
├── tsconfig.json
└── .env.example
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start all services in development mode |
| `npm run build` | Build all packages |
| `npm run test` | Run all tests |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run lint` | Run linting across all packages |
| `npm run docker:up` | Start Docker Compose services |
| `npm run docker:down` | Stop Docker Compose services |
| `npm run docker:logs` | View Docker Compose logs |
| `npm run db:migrate` | Run database migrations |
| `npm run db:seed` | Seed database with test data |

## Services

### Infrastructure (Docker)

- **PostgreSQL** - Primary database (port 5432)
- **Redis** - Caching and pub/sub (port 6379)

### Application

- **Backend API** - REST API server (port 3000)
- **Frontend** - React dashboard (port 5173 in dev, port 80 in production)
- **Sync Engine** - Background sync worker

## Integrations

- **EposNow** - Point of sale system
- **Wix** - E-commerce platform
- **Otter** - Restaurant delivery aggregator

## Development

### Adding a new package

1. Create the package directory:
   ```bash
   mkdir -p packages/new-package/src
   ```

2. Add package.json and tsconfig.json

3. Update root tsconfig.json references

### Running individual packages

```bash
# Run specific workspace
npm run dev --workspace=packages/backend

# Run tests for specific workspace
npm run test --workspace=packages/frontend
```

## Environment Variables

See `.env.example` for all available configuration options.

### Required Variables

- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - Secret key for JWT tokens

### Integration APIs

- `EPOSNOW_API_KEY` / `EPOSNOW_API_SECRET` - EposNow credentials
- `WIX_CLIENT_ID` / `WIX_CLIENT_SECRET` - Wix OAuth credentials
- `OTTER_API_KEY` - Otter API key

## License

Private - All rights reserved
