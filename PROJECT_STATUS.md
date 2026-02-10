# StockClerk.ai — Project Status & Context

**Last Updated:** 10 February 2026
**Owner:** Luke (manjunath.kesani@gmail.com)
**First Customer:** LGHP (testing this week)

---

## What Is StockClerk.ai?

A multi-tenant inventory synchronization SaaS platform. Connects a retailer's POS system (Eposnow), online store (Wix), and delivery platforms (Deliveroo/Otter) so stock levels stay in sync across all channels automatically.

**Core Value Prop:** "You sell a sandwich on Deliveroo, your Eposnow POS and Wix store stock update instantly."

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND (Vercel)              BACKEND (Railway)               │
│  ┌──────────────────┐           ┌──────────────────────────┐    │
│  │ React SPA (Vite) │──────────▶│ Fastify API Server       │    │
│  │  - Marketing page│  /api/*   │  - Auth (JWT)            │    │
│  │  - Dashboard     │  proxy    │  - Channels CRUD         │    │
│  │  - Onboarding    │           │  - Products CRUD         │    │
│  │  - Admin panel   │           │  - Sync triggers         │    │
│  │  - Wix Dashboard │           │  - Webhooks (3 channels) │    │
│  └──────────────────┘           │  - Billing (Stripe)      │    │
│                                 │  - Admin routes          │    │
│                                 │  - WebSocket (real-time)  │    │
│                                 └────────────┬─────────────┘    │
│                                              │                  │
│                  ┌───────────────────────────┼─────────┐        │
│                  │       SYNC ENGINE         │         │        │
│                  │  ┌─────────┐  ┌──────────┴──┐      │        │
│                  │  │ Watcher │  │ Sync Agent  │      │        │
│                  │  │ Agent   │  │ (propagate) │      │        │
│                  │  └─────────┘  └─────────────┘      │        │
│                  │  ┌──────────┐  ┌──────────────┐    │        │
│                  │  │ Guardian │  │ Alert Agent  │    │        │
│                  │  │ (drift)  │  │ (low stock)  │    │        │
│                  │  └──────────┘  └──────────────┘    │        │
│                  └────────────────────────────────────┘        │
│                                                                 │
│  ┌─────────┐  ┌──────────────┐  ┌──────────┐                   │
│  │ Postgres│  │ Redis/BullMQ │  │ Stripe   │                   │
│  │ (Neon)  │  │ (job queues) │  │ Billing  │                   │
│  └─────────┘  └──────────────┘  └──────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind + Zustand |
| Backend | Fastify + TypeScript + Drizzle ORM |
| Database | PostgreSQL (Neon) |
| Queues | BullMQ + Redis (Upstash) |
| Sync Engine | Custom 4-agent system (Watcher, Sync, Guardian, Alert) |
| Integrations | @stockclerk/integrations package (Eposnow, Wix, Otter APIs) |
| Billing | Stripe (14-day trial, Starter £50/mo, Growth £100/mo) |
| Frontend Hosting | Vercel |
| Backend Hosting | Railway |
| Real-time | WebSocket (Fastify WebSocket plugin) |

### Monorepo Structure

```
stockclerk-temp/
├── packages/
│   ├── frontend/          # React SPA
│   │   ├── src/
│   │   │   ├── api/client.ts         # All API methods (authApi, channelsApi, productsApi, etc.)
│   │   │   ├── stores/authStore.ts   # Zustand auth state + JWT management
│   │   │   ├── hooks/useWebSocket.ts # Real-time WebSocket hook
│   │   │   ├── pages/
│   │   │   │   ├── Dashboard.tsx     # Main user dashboard
│   │   │   │   ├── Products.tsx      # Product management
│   │   │   │   ├── Channels.tsx      # Channel management
│   │   │   │   ├── Settings.tsx      # Account settings
│   │   │   │   ├── Onboarding/      # Multi-step onboarding flow
│   │   │   │   └── Admin/           # Super admin pages (Dashboard, Tenants, SyncMonitor, SystemHealth)
│   │   │   └── components/
│   │   │       └── layout/
│   │   │           ├── Sidebar.tsx    # Main app sidebar (◉ logo, nav, sign out)
│   │   │           └── AdminLayout.tsx # Admin sidebar
│   │   ├── public/                   # Static assets (marketing.html, privacy.html, etc.)
│   │   ├── wix-dashboard.html        # Wix App Market embedded dashboard
│   │   └── vite.config.ts
│   │
│   ├── backend/           # Fastify API server
│   │   ├── src/
│   │   │   ├── index.ts              # Server entry point
│   │   │   ├── config/index.ts       # Environment config
│   │   │   ├── db/
│   │   │   │   ├── schema.ts         # Drizzle schema (tenants, users, channels, products, etc.)
│   │   │   │   └── index.ts          # DB connection
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts           # Register, login, profile, password change
│   │   │   │   ├── channels.ts       # CRUD + Wix OAuth flow
│   │   │   │   ├── products.ts       # CRUD + stock updates
│   │   │   │   ├── sync.ts           # Trigger syncs
│   │   │   │   ├── webhooks.ts       # Eposnow, Wix, Otter webhook receivers
│   │   │   │   ├── billing.ts        # Stripe integration
│   │   │   │   ├── admin.ts          # Super admin routes
│   │   │   │   ├── dashboard.ts      # Dashboard stats API
│   │   │   │   ├── alerts.ts         # Alert management
│   │   │   │   ├── enquiries.ts      # Enterprise enquiry form
│   │   │   │   ├── eposnow-appstore.ts # Eposnow App Store OAuth
│   │   │   │   └── wix-marketplace.ts  # Wix App Market integration
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts           # JWT authentication
│   │   │   │   └── admin.ts          # Super admin check
│   │   │   ├── queues/index.ts       # BullMQ queue setup (global + tenant-scoped)
│   │   │   ├── sync-integration.ts   # Wires sync engine to DB + WebSocket + queues
│   │   │   ├── websocket/index.ts    # WebSocket server + broadcast helpers
│   │   │   └── types/index.ts        # Shared TypeScript types
│   │   └── vitest.config.ts
│   │
│   ├── sync-engine/       # 4-agent sync engine
│   │   ├── src/
│   │   │   ├── engine.ts             # SyncEngine class (coordinates all agents)
│   │   │   ├── events.ts             # EventEmitter3-based event bus
│   │   │   ├── agents/
│   │   │   │   ├── watcher.ts        # Watches for external changes
│   │   │   │   ├── sync.ts           # Propagates stock updates to other channels
│   │   │   │   ├── guardian.ts       # Periodic drift detection + auto-repair
│   │   │   │   └── alert.ts          # Low stock, channel disconnect alerts
│   │   │   ├── orchestrator/         # NEW: Per-tenant process isolation
│   │   │   │   ├── types.ts          # IPC message types, health status
│   │   │   │   ├── TenantOrchestrator.ts  # Parent process: spawn/monitor/restart workers
│   │   │   │   ├── tenant-worker.ts  # Child process: isolated sync engine per tenant
│   │   │   │   └── index.ts          # Barrel exports
│   │   │   └── types.ts              # Sync engine types
│   │   └── vitest.config.ts
│   │
│   └── integrations/      # Channel API adapters
│       └── src/
│           ├── providers/
│           │   ├── eposnow.ts
│           │   ├── wix.ts
│           │   └── otter.ts
│           └── index.ts
│
├── docker/
│   ├── Dockerfile.backend
│   ├── Dockerfile.frontend
│   └── nginx.conf
│
├── vercel.json            # Frontend deployment config
├── SCALABILITY_ARCHITECTURE.md  # Detailed scaling guide
└── SCALABILITY_QUICKSTART.md    # Quick reference
```

---

## Database Schema (Key Tables)

| Table | Key Columns | Purpose |
|---|---|---|
| tenants | id, name, slug (UNIQUE), plan, planStatus, stripeCustomerId, stripeSubscriptionId, shopLimit, trialEndsAt | Multi-tenant root |
| users | id, tenantId (FK), email (UNIQUE), passwordHash, role, onboardingComplete, isSuperAdmin | Auth + RBAC |
| channels | id, tenantId (FK), type (eposnow/wix/deliveroo/otter), name, credentialsEncrypted (AES-256-GCM), isActive, externalInstanceId, webhookSecret | Sales channels |
| products | id, tenantId (FK), sku, name, currentStock, bufferStock, metadata (JSONB) | Inventory |
| productChannelMappings | id, productId (FK), channelId (FK), externalId, externalSku | Cross-channel product links |
| syncEvents | id, tenantId (FK), eventType, channelId, productId, status, errorMessage | Audit trail |
| alerts | id, tenantId (FK), type, message, metadata, isRead | Alert system |

---

## Deployment Configuration

### Vercel (Frontend)
- **buildCommand:** `npm run build --workspace=packages/frontend && mv packages/frontend/dist/index.html packages/frontend/dist/app.html`
- **outputDirectory:** `packages/frontend/dist`
- **Rewrites:** `/` → `/marketing.html` (marketing page), `/(.*) → /app.html` (SPA catch-all), `/api/*` → Railway backend, `/webhooks/*` → Railway backend, `/marketplace/*` → Railway backend

### Railway (Backend)
- **Dockerfile:** `docker/Dockerfile.backend`
- **Services:** Backend API, Redis (Upstash)
- **Environment:** PORT, DATABASE_URL, REDIS_URL, JWT_SECRET, STRIPE_SECRET_KEY, ENCRYPTION_KEY, etc.

---

## Current Build Status (10 Feb 2026)

### Ralph Loop Results — ALL CLEAN

| Check | Result |
|---|---|
| TypeScript (3 packages) | **0 errors** |
| Tests | **216 passed, 0 failed, 12 test files** |
| Frontend Vite build | **2.05s, all chunks OK** |
| Backend esbuild | **934KB, 129ms** |
| System simulation | **10/10 steps verified** |
| Import/export integrity | **All 14 lazy imports resolve, 30+ API endpoints matched** |

### Test Coverage by Package

| Package | Tests | Files |
|---|---|---|
| @stockclerk/backend | 95 tests | auth, channels, products, webhooks |
| @stockclerk/frontend | 50 tests | Dashboard, Products, useWebSocket |
| @stockclerk/sync-engine | 71 tests | engine, watcher, guardian, websocket |

---

## What Was Fixed (This Session)

### TypeScript Fixes (59+ errors resolved)
- **Drizzle ORM type inference regression:** Added `as typeof tableName.$inferInsert` to all `.values()` calls and `as Partial<typeof tableName.$inferSelect>` to all `.set()` calls across 10+ route files
- **Fastify/Pino logger signature:** Changed `app.log.error("msg", err)` to `app.log.error({ err }, "msg")` across 7 files
- **EventEmitter3 v5:** Changed from default to named import
- **ioredis:** Changed from default to named import

### Test Fixes (20 failures → 0)
- **vi.hoisted() pattern:** Applied to all backend test mocks (auth, channels, products, webhooks)
- **Vitest configs:** Created per-package configs to exclude setup/utils files
- **Missing dependency:** Installed @testing-library/user-event

### Real Production Bugs Found & Fixed
1. **Webhook signature never verified:** `getChannelByExternalId()` was stripping `webhookSecret` from return value. Fixed by passing through the full channel properties.
2. **Otter webhook SHA1 mismatch:** `verifyHmacSignatureWithPrefix` defaulted to SHA256 but Otter uses SHA1. Fixed by passing `'sha1'` as 5th argument.
3. **channelSecretCache leaking between tests:** Module-level Map persisted. Added `clearChannelSecretCache()` export.

### New Features Built
1. **Admin pages (6 files):** Dashboard, Tenants list, TenantDetail, SyncMonitor, SystemHealth + AdminLayout
2. **Per-tenant process isolation (4 files):** TenantOrchestrator, tenant-worker, IPC types, barrel exports
3. **Tenant-scoped queues:** `getTenantQueueNames()`, `addTenantSyncJob()`, `addTenantWebhookJob()`, `addTenantAlertJob()`
4. **Admin health endpoints:** `/admin/system-health` (with orchestrator status), `/admin/tenant-health/:tenantId`

---

## Per-Tenant Process Isolation Architecture

**Toggle:** Set `TENANT_ISOLATION=true` in Railway environment variables.

**Without it (default):** All tenants share a single SyncEngine, global BullMQ queues, global Guardian loop. Fine for 1-50 tenants.

**With it:** Each tenant gets:
- A **child_process.fork()** with its own V8 heap (256MB cap)
- Its own BullMQ queues: `stockclerk:<tenantId>:sync`, `:webhook`, `:alert`, `:stock-update`
- Its own Guardian reconciliation loop (15-minute intervals)
- Crash isolation: if one tenant's worker dies, all others continue unaffected
- Auto-restart with exponential backoff (5s → 10s → 20s → 40s, max 10 restarts)
- Health monitoring via IPC heartbeats (30s interval)

**Files:**
- `packages/sync-engine/src/orchestrator/TenantOrchestrator.ts` — Parent process manager
- `packages/sync-engine/src/orchestrator/tenant-worker.ts` — Child process entry point
- `packages/sync-engine/src/orchestrator/types.ts` — IPC message definitions
- `packages/backend/src/sync-integration.ts` — `routeSyncJob()` and `routeWebhookJob()` auto-route to correct destination

---

## Pricing Tiers

| Tier | Price | Shops | Features |
|---|---|---|---|
| Trial | Free (14 days) | 3 | Full features |
| Starter | £50/mo | 3 shops | Core sync, dashboard, alerts |
| Growth | £100/mo | 10 shops | Everything in Starter + priority support |
| Enterprise | Enquiry-based | Unlimited | Custom SLAs, dedicated support |

---

## Marketplace Integrations

### Wix App Market
- OAuth flow: `/channels/wix/oauth-start` → Wix consent → `/channels/wix/oauth-callback`
- Dashboard widget: `wix-dashboard.html` (embedded iframe in Wix admin)
- Webhook receiver: `POST /webhooks/wix`

### Eposnow App Store
- OAuth flow: `/marketplace/eposnow/install` → Eposnow consent → `/marketplace/eposnow/callback`
- Webhook receiver: `POST /webhooks/eposnow` (HMAC-SHA256 signature verification)

### Otter/Deliveroo
- Webhook receiver: `POST /webhooks/otter` (HMAC-SHA1 signature verification)

---

## Key Technical Patterns

### Drizzle ORM Type Pattern
```typescript
// Insert: use $inferInsert assertion
await db.insert(table).values({ ...data } as typeof table.$inferInsert).returning();

// Update: use Partial<$inferSelect> assertion
await db.update(table).set({ ...data } as Partial<typeof table.$inferSelect>).where(...);
```

### Fastify Logger Pattern
```typescript
// Correct Pino signature (object-first)
app.log.error({ err }, 'Error message');

// WRONG:
app.log.error('Error message', err);
```

### vi.hoisted() Test Pattern
```typescript
const { mockDb, mockFn } = vi.hoisted(() => ({
  mockDb: { select: vi.fn(), insert: vi.fn(), ... },
  mockFn: vi.fn(),
}));

vi.mock('../db/index.js', () => ({ db: mockDb }));
```

---

## What Needs Doing Next

### Immediate (Before LGHP Testing)
1. **Deploy latest changes:** Commit everything, push to git, deploy to Vercel + Railway
2. **Set up production environment:** Ensure all Railway env vars are set (DATABASE_URL, REDIS_URL, JWT_SECRET, STRIPE_SECRET_KEY, ENCRYPTION_KEY, etc.)
3. **Run database migrations:** Ensure Neon PostgreSQL schema is up to date
4. **Smoke test on production:** Register → onboard → connect Eposnow → sync → verify dashboard
5. **Set up monitoring:** Check Railway logs, Vercel deployment status

### Short-term
1. **LGHP onboarding:** Help them connect their Eposnow + Wix channels
2. **Enable tenant isolation:** Set `TENANT_ISOLATION=true` once comfortable with the system
3. **Stripe billing go-live:** Connect production Stripe keys, test checkout flow

### Medium-term
1. **Email notifications:** Transactional emails for alerts, low stock, sync failures
2. **Deliveroo/Otter integration testing:** Currently implemented but needs real-world testing
3. **Performance optimization:** Database indexing, query optimization for dashboard
4. **Mobile-responsive dashboard:** Current UI is desktop-focused

---

## Files Modified in Most Recent Session

### Created
- `packages/frontend/src/components/layout/AdminLayout.tsx`
- `packages/frontend/src/pages/Admin/Dashboard.tsx`
- `packages/frontend/src/pages/Admin/Tenants.tsx`
- `packages/frontend/src/pages/Admin/TenantDetail.tsx`
- `packages/frontend/src/pages/Admin/SyncMonitor.tsx`
- `packages/frontend/src/pages/Admin/SystemHealth.tsx`
- `packages/backend/vitest.config.ts`
- `packages/frontend/vitest.config.ts`
- `packages/sync-engine/vitest.config.ts`
- `packages/sync-engine/src/orchestrator/types.ts`
- `packages/sync-engine/src/orchestrator/TenantOrchestrator.ts`
- `packages/sync-engine/src/orchestrator/tenant-worker.ts`
- `packages/sync-engine/src/orchestrator/index.ts`
- `SCALABILITY_ARCHITECTURE.md`
- `SCALABILITY_QUICKSTART.md`
- `PROJECT_STATUS.md` (this file)

### Modified (Bug Fixes + Isolation Wiring)
- All backend route files (auth, alerts, billing, channels, products, enquiries, eposnow-appstore, wix-marketplace, sync, webhooks, dashboard, admin)
- `packages/backend/src/index.ts`
- `packages/backend/src/websocket/index.ts`
- `packages/backend/src/queues/index.ts`
- `packages/backend/src/sync-integration.ts`
- `packages/backend/src/types/index.ts`
- `packages/sync-engine/src/events.ts`
- `packages/sync-engine/src/engine.ts`
- `packages/sync-engine/src/agents/watcher.ts`
- `packages/sync-engine/tsconfig.json`
- `packages/sync-engine/package.json`
- Multiple test files across all packages

---

## Git Status

**Unpushed changes:** All the above files need to be committed and pushed. Previous push attempt failed due to wrong directory path.

**Repository:** Needs `git add`, `git commit`, and `git push` from the correct directory (`/sessions/tender-gracious-feynman/mnt/Downloads/stockclerk-temp`).
