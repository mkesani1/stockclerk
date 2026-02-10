# StockClerk.ai Scalability Architecture

## Executive Summary

StockClerk's current architecture uses a **monolithic agent system** where all four AI agents (Watcher, Sync, Guardian, Alert) run as a single global SyncEngine instance, processing jobs across all tenants through shared BullMQ queues in Redis.

This document outlines:
1. How the current system works
2. What happens when new customers sign up
3. Scaling limits and at what point architecture changes are needed
4. Specific architectural changes for each growth phase
5. Cost implications on Railway

**Key Insight**: At ~50 tenants with moderate activity, the monolithic agent approach will hit resource contention and queue bottlenecks. Per-tenant agent isolation is needed before scaling to 200+ tenants.

---

## Part 1: Current Architecture

### 1.1 How the System Works Today

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (SvelteKit)                         │
│    Dashboard, Product Mgmt, Channel Setup, Alerts                    │
└────────────────────────────┬────────────────────────────────────────┘
                             │ WebSocket + REST API
┌─────────────────────────────▼────────────────────────────────────────┐
│                    BACKEND (Fastify)                                  │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ REST Routes: /api/channels, /api/products, /api/sync, etc.   │   │
│  │ Webhook Routes: /webhooks/eposnow, /webhooks/wix, etc.       │   │
│  │ Dashboard: Agent status, queue stats, sync events             │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                             │                                         │
│  ┌──────────────────────────▼───────────────────────────────────┐   │
│  │        Sync Integration Layer                                 │   │
│  │   (packages/backend/src/sync-integration.ts)                  │   │
│  │  - Database ops (getProductMapping, updateProductStock)      │   │
│  │  - Queue job processors                                       │   │
│  │  - Guardian reconciliation schedule (every 15 min)            │   │
│  │  - Worker registration (webhook, sync, alert)                │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                             │                                         │
└─────────────────────────────┼─────────────────────────────────────────┘
                              │ Process jobs, emit events
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────▼──────────┐  ┌───────▼──────────┐  ┌──────▼────────────┐
│  REDIS (Shared)  │  │  DATABASE        │  │  EXTERNAL APIS    │
│                  │  │  (Postgres)      │  │  (Wix, Eposnow,   │
│ Queues:          │  │                  │  │   Deliveroo)      │
│ - webhook        │  │ Products         │  │                   │
│ - sync           │  │ Channels         │  │ Event Webhooks    │
│ - guardian       │  │ Mappings         │  │ Stock APIs        │
│ - alert          │  │ Sync Events      │  │                   │
│                  │  │ Alerts           │  │                   │
└───────┬──────────┘  └──────────────────┘  └───────────────────┘
        │
        └─────────┬──────────────────┬──────────────────┬──────────────┐
                  │                  │                  │              │
        ┌─────────▼──────┐  ┌────────▼────────┐  ┌─────▼──────────┐  │
        │  SYNC ENGINE   │  │  (Workers)      │  │  (Workers)     │  │
        │                │  │                 │  │                │  │
        │ 4 AI Agents:   │  │ Webhook Worker  │  │ Sync Worker    │  │
        │                │  │ (concurrency:10)│  │ (concurrency:5)│  │
        │ 1. Watcher     │  │                 │  │                │  │
        │    - Webhook   │  │ Alert Worker    │  │ Guardian       │  │
        │      processing│  │ (concurrency:3) │  │ Reconciliation │  │
        │    - Eposnow   │  │                 │  │ (every 15 min) │  │
        │      polling   │  └────────────────┘  └────────────────┘  │
        │                │                                            │
        │ 2. Sync        │  All agents share:                        │
        │    - Multi-ch  │  - Single Redis connection                │
        │      atomic    │  - Single event bus (EventEmitter3)       │
        │      updates   │  - All tenant data                        │
        │    - Buffer    │  - Global queue processing                │
        │      stock     │                                            │
        │                │                                            │
        │ 3. Guardian    │                                            │
        │    - 15-min    │                                            │
        │      reconcil. │                                            │
        │    - Auto-fix  │                                            │
        │      small     │                                            │
        │      drifts    │                                            │
        │                │                                            │
        │ 4. Alert Agent │                                            │
        │    - Stock     │                                            │
        │      checks    │                                            │
        │    - Channel   │                                            │
        │      health    │                                            │
        │                │                                            │
        └────────────────┘                                            │
                                                                      │
        Orchestration: packages/sync-engine/src/engine.ts             │
        - Creates all 4 agents                                        │
        - Manages lifecycle (start/stop)                              │
        - Coordinates events via EventBus                             │
        - Tracks stats                                                │
                                                          │
                                                          │
        ┌─────────────────────────────────────────────────┘
        │
        │ Lives in process:
        │ packages/backend/src/index.ts creates and starts engine
        └─►(initializeSyncEngineIntegration)
```

### 1.2 Current Agent Architecture (Single Global Instance)

**File Locations:**
- Main orchestrator: `/packages/sync-engine/src/engine.ts` (SyncEngine class)
- Agent implementations: `/packages/sync-engine/src/agents/`
  - `watcher.ts` - Webhook processing + Eposnow polling
  - `sync.ts` - Multi-channel atomic updates
  - `guardian.ts` - Reconciliation & drift detection
  - `alert.ts` - Alert generation

**Key Characteristics:**

1. **Single SyncEngine Instance** (per backend process)
   - Created once in `packages/backend/src/index.ts`
   - Initializes all 4 agents
   - Manages their lifecycle (start/stop)
   - Emits events via shared EventBus

2. **Shared BullMQ Queues** (Global, all tenants)
   ```typescript
   // From packages/backend/src/queues/index.ts
   const QUEUE_NAMES = {
     SYNC: 'stockclerk:sync',           // All tenants' sync jobs
     WEBHOOK: 'stockclerk:webhook',     // All tenants' webhooks
     ALERT: 'stockclerk:alert',         // All tenants' alerts
     STOCK_UPDATE: 'stockclerk:stock-update'
   };
   ```

3. **Per-Agent Queues** (Inside SyncEngine)
   ```typescript
   // From watcher.ts (line 26)
   const QUEUE_NAME = 'stockclerk:webhook:process'; // Watcher's internal queue

   // From sync.ts
   const QUEUE_NAME = 'stockclerk:sync'; // Shared with backend

   // From guardian.ts
   const QUEUE_NAME = 'stockclerk:guardian:reconcile';

   // From alert.ts
   const QUEUE_NAME = 'stockclerk:alert:check';
   ```

4. **Data Flow**
   - Webhook arrives at `/webhooks/eposnow`
   - Backend adds job to `stockclerk:webhook` queue
   - Backend's webhook worker processes and calls `addWebhookJob()` on engine
   - Watcher Agent processes from `stockclerk:webhook:process`
   - Watcher emits `stock:change` events
   - Sync Agent listens to events, pulls from `stockclerk:sync` queue
   - Guardian polls `stockclerk:guardian:reconcile` every 15 minutes
   - Alert Agent checks `stockclerk:alert:check` queue

### 1.3 Tenant Isolation Model (Current)

**Current State: No tenant isolation**

```typescript
// From packages/sync-engine/src/engine.ts (line 102)
export class SyncEngine {
  private watcherAgent: WatcherAgent | null = null;
  private syncAgent: SyncAgent | null = null;
  private guardianAgent: GuardianAgent | null = null;
  private alertAgent: AlertAgent | null = null;

  // Single event bus for ALL tenants
  private readonly eventBus: SyncEngineEventBus;
}
```

**How tenants are identified:**
- Each job includes `tenantId` in its data payload
- Database queries filter by `tenantId`
- All agents process jobs for ALL tenants

**Example from Sync Agent:**
```typescript
// From sync.ts - processes jobs for ANY tenant
async triggerFullSync(tenantId: string): Promise<void> {
  // Adds job to shared 'stockclerk:sync' queue
  // No tenant-specific queue
}
```

**Example from Guardian:**
```typescript
// From guardian.ts - reconciles ALL tenants every 15 minutes
async reconciliationTimer: NodeJS.Timeout | null = null;

// Runs periodic job that:
const tenantIds = await deps.getAllTenantIds();
for (const tenantId of tenantIds) {
  // Check all products for this tenant
  // Check all channels for this tenant
}
```

### 1.4 Queue System Architecture

**Global Queue Setup** (`packages/backend/src/queues/index.ts`)

```typescript
// Single Redis connection (line 62)
redisConnection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Global queues (all tenants mixed)
syncQueue = new Queue<SyncJobData>(QUEUE_NAMES.SYNC, { connection });
webhookQueue = new Queue<WebhookJobData>(QUEUE_NAMES.WEBHOOK, { connection });
alertQueue = new Queue<AlertJobData>(QUEUE_NAMES.ALERT, { connection });
```

**Worker Registration** (lines 235-317)

```typescript
// Single worker processes all tenants' jobs
registerSyncWorker(processor, concurrency = 5)
  // 5 concurrent workers process jobs from 'stockclerk:sync'
  // No tenant-specific concurrency limits

registerWebhookWorker(processor, concurrency = 10)
  // 10 concurrent workers for webhooks

registerAlertWorker(processor, concurrency = 3)
  // 3 concurrent workers for alerts
```

**Job Data Structure** (shows tenantId is embedded)

```typescript
interface SyncJobData {
  tenantId: string;        // Tenant identifier
  channelId: string;
  channelType: ChannelType;
  operation: string;
  productIds?: string[];
}

interface AlertJobData {
  tenantId: string;        // Tenant identifier
  checkType: 'low_stock' | 'sync_health' | 'channel_status' | 'all';
  productId?: string;
  channelId?: string;
}
```

### 1.5 Backend Integration Point

**File:** `packages/backend/src/sync-integration.ts`

**Key Function: Initialization (lines 973-981)**

```typescript
export function initializeSyncEngineIntegration(): void {
  // Called once when backend starts

  // 1. Initialize queue workers
  initializeSyncEngineWorkers();

  // 2. Start guardian reconciliation (runs every 15 minutes)
  startGuardianSchedule();
}
```

**Queue Job Processors:**

```typescript
// Line 601: Process webhooks
export async function processWebhookJob(job: {
  data: {
    tenantId: string;
    channelId: string;
    channelType: ChannelType;
    eventType: string;
    payload: Record<string, unknown>;
  };
}): Promise<void>

// Line 671: Process sync jobs
export async function processSyncJob(job: {
  data: {
    tenantId: string;
    channelId: string;
    channelType: ChannelType;
    operation: string;
    productIds?: string[];
  };
}): Promise<void>

// Line 766: Process alert checks
export async function processAlertJob(job: {
  data: {
    tenantId: string;
    checkType: 'low_stock' | 'sync_health' | 'channel_status' | 'all';
    productId?: string;
    channelId?: string;
    threshold?: number;
  };
}): Promise<void>
```

**Guardian Reconciliation Schedule (lines 877-953)**

```typescript
export function startGuardianSchedule(intervalMs = 15 * 60 * 1000): void {
  // Runs every 15 minutes

  reconciliationInterval = setInterval(async () => {
    const tenantIds = await getAllTenantIds();

    // For EACH tenant:
    for (const tenantId of tenantIds) {
      const channelList = await getChannels(tenantId);
      const productList = await getProducts(tenantId);

      // For EACH product:
      for (const product of productList) {
        const mappings = await getProductMappings(product.id);

        // For EACH channel mapping:
        for (const mapping of mappings) {
          // Compare internal stock vs channel stock
          // Auto-repair if drift <= 5
          // Create alert if drift > 5
        }
      }
    }
  }, intervalMs);
}
```

### 1.6 Agent Status Tracking

**File:** `packages/backend/src/routes/dashboard.ts`

```typescript
// In-memory agent status store (line 45)
const agentStatusStore: Record<string, AIAgentStatus> = {};

// Agent status types (lines 15-23)
type AgentStatus = 'active' | 'idle' | 'error';

interface AIAgentStatus {
  watcher: AgentStatus;
  sync: AgentStatus;
  guardian: AgentStatus;
  alert: AgentStatus;
}

// Update function called by sync-integration (line 48)
export function updateAgentStatus(
  tenantId: string,
  agent: keyof AIAgentStatus,
  status: AgentStatus
): void {
  agentStatusStore[tenantId][agent] = status;
}
```

**Status is per-tenant but tracked in memory** (will be lost on restart, not replicated)

---

## Part 2: What Happens When a New Customer Signs Up

### 2.1 Tenant Creation Flow

**Step 1: Signup/Onboarding** (via REST API)
```
POST /api/auth/signup
  → Create tenant record in database
  → Create user record (owner)
  → Assign tenant subscription tier
  → Return auth token
```

**Step 2: Channel Connection**
```
POST /api/channels/connect
  → User selects channel type (Eposnow, Wix, Deliveroo)
  → Provides credentials
  → Backend validates credentials
  → Creates channel record with encrypted credentials
  → Stores in DB: channels table
```

**Step 3: Product Setup**
```
POST /api/products
  → User creates products in StockClerk
  → Backend creates product records
  → Backend creates channel mappings (product ↔ external ID)
  → Stores in DB: products, productChannelMappings tables
```

**Step 4: Agent Processing**
```
NEW TENANT DISCOVERY:
  When guardian runs reconciliation loop:
    const tenantIds = await getAllTenantIds();
    → Discovers new tenant
    → Runs reconciliation for new tenant
    → Agents begin processing jobs for this tenant

NO EXPLICIT AGENT SPIN-UP:
  - No per-tenant agent instance
  - No tenant-specific queue created
  - New tenant's jobs go into global queues
  - Global agents process them
```

### 2.2 Queue Job Flow for New Tenant

**When first webhook arrives for new tenant:**

```
1. Webhook POST /webhooks/eposnow
   ├─ Validates signature
   ├─ Parses tenant ID from signature/headers
   ├─ Calls addWebhookJob({
   │    tenantId: "tenant_xyz",
   │    channelId: "channel_123",
   │    channelType: "eposnow",
   │    eventType: "stock.updated",
   │    payload: {...}
   │  })
   └─ Returns immediately

2. Job added to GLOBAL queue: stockclerk:webhook
   ├─ Database webhook worker picks up
   ├─ Calls processWebhookJob() in sync-integration.ts
   ├─ Looks up product mapping: getProductMapping(tenantId, channelId, externalId)
   ├─ Updates product stock: updateProductStock(productId, newQuantity)
   ├─ Creates sync event: createSyncEvent(...)
   └─ Adds sync job: addSyncJob({tenantId: "tenant_xyz", ...})

3. Sync job added to GLOBAL queue: stockclerk:sync
   ├─ Sync worker picks up
   ├─ Calls processSyncJob() in sync-integration.ts
   ├─ For each product, gets all channel mappings
   ├─ Updates other channels with new stock
   └─ Emits WebSocket event to frontend
```

### 2.3 Cost of Adding New Tenant (Current Architecture)

**No new resources spun up:**
- ✓ Single SyncEngine instance processes all jobs
- ✓ Single set of workers (5 sync, 10 webhook, 3 alert)
- ✓ Single Redis connection
- ✓ Single EventBus
- ✓ New tenant's data just added to database

**What increases:**
- Database rows (1 tenant, N products, N channels, N mappings)
- Queue job volume (more jobs per cycle)
- Guardian reconciliation time (more tenants to loop through)
- Memory usage (minimal - just stores more IDs in loops)

---

## Part 3: Current Architecture's Scaling Limits

### 3.1 Scenario A: 1-10 Tenants (Launch Phase with LGHP)

**Current Setup is Perfect:**

| Metric | Value |
|--------|-------|
| Active Tenants | 1-10 |
| Avg Products/Tenant | 20-50 |
| Avg Channels/Tenant | 1-3 |
| Webhooks/Minute | 5-20 |
| Queued Jobs/Minute | 10-50 |
| Memory per Worker | ~50-100 MB |
| Redis Memory | ~100 MB |
| CPU Usage | <10% |

**Architecture:**
- Single backend process (Railway)
- Single SyncEngine with 4 agents
- Global queues and workers
- All agents in-memory in one process

**Cost (Railway):**
- 1 backend service: $5-10/month (hobby tier)
- 1 Redis instance: $5-10/month (hobby tier)
- 1 Postgres DB: Included in Railway

**Total: ~$10-20/month**

**No bottlenecks:**
- Workers idle most of the time
- Guardian reconciliation completes in <1 second per tenant
- Event bus handles all events without latency
- Redis memory flat

**Changes needed:** None. Ship it.

---

### 3.2 Scenario B: 10-50 Tenants (Growth Phase)

**Bottlenecks Begin to Emerge:**

| Metric | Value |
|--------|-------|
| Active Tenants | 10-50 |
| Avg Products/Tenant | 50-100 |
| Avg Channels/Tenant | 2-4 |
| Webhooks/Minute | 50-200 |
| Queued Jobs/Minute | 100-400 |
| Guardian Reconciliation | 5-15 seconds |
| Memory Usage | 200-400 MB |
| Redis Memory | 200-500 MB |
| CPU Usage | 30-50% |

**Emerging Issues:**

1. **Guardian Reconciliation Slowdown**
   - Current: `startGuardianSchedule()` runs every 15 minutes
   - Problem: Takes 5-15 seconds to complete
   - Issue: Nested loops: tenants → products → channels
   - Example: 50 tenants × 100 products × 3 channels = 15,000 API calls

2. **Worker Queue Saturation**
   - Webhook worker (concurrency: 10) may queue up
   - Sync worker (concurrency: 5) falls behind during peaks
   - Alert worker (concurrency: 3) delays health checks

3. **Redis Memory Growth**
   - Queue job backlog persists longer
   - Event cache grows
   - Job history accumulates

4. **Single Point of Failure**
   - One backend process down = all tenants affected
   - Guardian interval triggers on one instance (no redundancy)
   - Workers run only in active backend process

**When to Intervene:**
- Guardian reconciliation takes > 10 seconds
- Webhook queue has >50 pending jobs at peak hours
- CPU usage consistently > 60%
- Memory usage approaches 500 MB

**Required Changes:**

#### Change 1: Increase Worker Concurrency
```typescript
// In packages/backend/src/queues/index.ts
registerWebhookWorker(processor, concurrency = 20);  // Was 10
registerSyncWorker(processor, concurrency = 10);      // Was 5
registerAlertWorker(processor, concurrency = 5);      // Was 3
```

#### Change 2: Optimize Guardian Reconciliation

**Option A: Batch Processing (Quick Fix)**
```typescript
// Instead of nested loops, batch by tenant
export function startGuardianSchedule(intervalMs = 15 * 60 * 1000): void {
  reconciliationInterval = setInterval(async () => {
    const tenantIds = await getAllTenantIds();
    const BATCH_SIZE = 5;

    for (let i = 0; i < tenantIds.length; i += BATCH_SIZE) {
      const batch = tenantIds.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(tenantId => reconcileTenant(tenantId))
      );
    }
  }, intervalMs);
}

async function reconcileTenant(tenantId: string) {
  const products = await getProducts(tenantId);
  const mappings = await Promise.all(
    products.map(p => getProductMappings(p.id))
  );

  // Check all mappings in parallel
  await Promise.all(
    mappings.flat().map(m => checkAndRepairDrift(m))
  );
}
```

**Option B: Per-Tenant Reconciliation (Better)**
```typescript
// Queue per-tenant reconciliation jobs instead of polling
export function startGuardianSchedule(): void {
  // Every 15 minutes, queue ONE reconciliation job per tenant
  reconciliationInterval = setInterval(async () => {
    const tenantIds = await getAllTenantIds();
    for (const tenantId of tenantIds) {
      await addReconciliationJob({
        tenantId,
        type: 'full'
      });
    }
  }, 15 * 60 * 1000);
}

// Guardian worker processes reconciliation jobs
// Can be parallelized: 10 concurrent tenants
registerGuardianWorker(processor, concurrency = 10);
```

#### Change 3: Add Horizontal Scaling

**Deploy multiple backend processes:**
```yaml
# Railway deployment config
services:
  backend:
    replicas: 2              # 2 backend instances
    resources:
      memory: 512MB
      cpu: 1
```

**Problem to solve:** Guardian reconciliation would run twice if we have 2 backends.

**Solution:** Use Redis distributed lock
```typescript
// packages/backend/src/sync-integration.ts

import { Lock } from 'ioredis-lock';

let guardianLock: Lock | null = null;

export async function startGuardianSchedule(intervalMs = 15 * 60 * 1000): void {
  reconciliationInterval = setInterval(async () => {
    const redisConnection = getRedisConnection();

    // Try to acquire lock (only one backend can have it)
    const lock = new Lock(redisConnection, 'guardian:reconciliation:lock', 60000);
    const acquired = await lock.acquire();

    if (!acquired) {
      console.log('Another backend is running reconciliation, skipping');
      return;
    }

    try {
      // Run reconciliation (same as before)
      const tenantIds = await getAllTenantIds();
      for (const tenantId of tenantIds) {
        // ... reconciliation logic
      }
    } finally {
      await lock.release();
    }
  }, intervalMs);
}
```

**Cost (Railway at 10-50 tenants):**
- 2 backend services: $10-20/month (growth tier × 2)
- 1 Redis instance (larger): $10-20/month (growth tier)
- 1 Postgres DB: Included
- **Total: ~$30-50/month**

---

### 3.3 Scenario C: 50-200 Tenants (Scale Phase)

**Monolithic Architecture Breaks Down:**

| Metric | Value |
|--------|-------|
| Active Tenants | 50-200 |
| Avg Products/Tenant | 100-500 |
| Avg Channels/Tenant | 2-5 |
| Webhooks/Minute | 200-1000 |
| Queued Jobs/Minute | 400-2000 |
| Guardian Reconciliation | 30-60 seconds |
| Workers Bottleneck | Constant backlog |
| Memory Usage | 800 MB - 2 GB |
| Redis Memory | 1-3 GB |
| CPU Usage | 80-100% |

**Critical Problems:**

1. **Guardian Reconciliation Can't Complete in 15 Minutes**
   - 200 tenants × 200 products × 3 channels = 120,000 checks
   - Even with batching: 30-60 seconds per cycle
   - Next cycle starts before previous finishes
   - Cascading failures

2. **Worker Queue Backlog**
   - Webhook queue: 200-500 pending jobs
   - Sync queue: 100-300 pending jobs
   - Alert queue: 50-100 pending jobs
   - Latency: 5-30 minutes for a webhook to process

3. **Single EventBus Overload**
   - 1000s of events emitted per minute
   - EventEmitter3 in-memory, not distributed
   - Loss of events if subscriptions can't keep up
   - WebSocket broadcasts to frontend delayed

4. **Redis Contention**
   - All agents fighting for same connection
   - Key collisions possible
   - Memory fragmentation
   - Network I/O saturation

5. **No Tenant Isolation**
   - One tenant's high-activity channel can starve others
   - Noisy neighbor problem
   - No way to prioritize or throttle

6. **Multi-Backend Coordination Issues**
   - With 4+ backends, guardian locks cause starvation
   - Workers on idle backends unused
   - Queue distribution uneven

**Must Implement: Per-Tenant Agent Isolation**

---

### 3.4 Scenario D: 200+ Tenants (Enterprise Scale)

**Monolithic Architecture Completely Fails:**

| Metric | Value |
|--------|-------|
| Active Tenants | 200-500+ |
| Webhooks/Minute | 1000-5000+ |
| Guardian Reconciliation | 120+ seconds (can't complete) |
| Queue Backlog | 5000+ jobs |
| Latency p99 | 30+ minutes |
| Worker Saturation | 100% (queued) |
| Memory Usage | 3-5 GB |
| Redis Memory | 5-10 GB |
| Failures | Regular timeouts, job loss |

**At this scale, fundamental redesign is required.**

---

## Part 4: Per-Tenant Agent Isolation Architecture

### 4.1 Design Principles

**Goal:** Isolate tenants so high-activity tenants don't starve low-activity ones.

**Key Changes:**

1. **Move from global queues to per-tenant queues**
2. **Move from global workers to per-tenant workers**
3. **Spin up/down agents dynamically based on tenant activity**
4. **Use distributed event bus (Redis Pub/Sub or similar)**
5. **Add tenant lifecycle management**

### 4.2 New Queue Structure

**Before (Monolithic):**
```
Queues (Global, all tenants):
  - stockclerk:webhook (all tenants)
  - stockclerk:sync (all tenants)
  - stockclerk:guardian:reconcile (all tenants)
  - stockclerk:alert:check (all tenants)

Workers (Global):
  - 1 webhook worker (concurrency 10)
  - 1 sync worker (concurrency 5)
  - 1 guardian worker (concurrency 3)
  - 1 alert worker (concurrency 3)
```

**After (Per-Tenant):**
```
Queues (Per-tenant):
  - stockclerk:webhook:tenant_001
  - stockclerk:sync:tenant_001
  - stockclerk:guardian:tenant_001
  - stockclerk:alert:tenant_001

  - stockclerk:webhook:tenant_002
  - stockclerk:sync:tenant_002
  - stockclerk:guardian:tenant_002
  - stockclerk:alert:tenant_002

  ... (one set per tenant)

Workers (Per-tenant pool):
  - Webhook worker pool (1 instance per 20 active tenants)
  - Sync worker pool (1 instance per 10 active tenants)
  - Guardian worker pool (1 instance per 15 active tenants)
  - Alert worker pool (1 instance per 30 active tenants)
```

### 4.3 Tenant Agent Lifecycle

**New Concept: TenantAgentManager**

```typescript
// File: packages/sync-engine/src/tenant-manager.ts (NEW)

export interface TenantAgentConfig {
  tenantId: string;
  webhookConcurrency: number;
  syncConcurrency: number;
  alertConcurrency: number;
  enabled: boolean; // trial expired, subscription paused, etc.
}

export class TenantAgentManager {
  private tenantAgents: Map<string, TenantAgentGroup> = new Map();
  private redisConnection: Redis;

  /**
   * Register a new tenant's queues and enable processing
   * Called when: tenant signs up, subscription activated, trial starts
   */
  async registerTenant(config: TenantAgentConfig): Promise<void> {
    const tenantId = config.tenantId;

    // Create per-tenant queues
    const queues = {
      webhook: new Queue(`stockclerk:webhook:${tenantId}`, { connection: this.redisConnection }),
      sync: new Queue(`stockclerk:sync:${tenantId}`, { connection: this.redisConnection }),
      guardian: new Queue(`stockclerk:guardian:${tenantId}`, { connection: this.redisConnection }),
      alert: new Queue(`stockclerk:alert:${tenantId}`, { connection: this.redisConnection }),
    };

    // Store mapping
    this.tenantAgents.set(tenantId, {
      queues,
      active: true,
      createdAt: new Date(),
    });

    // Seed guardian reconciliation job
    await queues.guardian.add('reconcile', { tenantId }, {
      repeat: { every: 15 * 60 * 1000 }, // Every 15 minutes
    });
  }

  /**
   * Pause a tenant's agents
   * Called when: subscription paused, trial expired
   */
  async pauseTenant(tenantId: string): Promise<void> {
    const group = this.tenantAgents.get(tenantId);
    if (!group) return;

    // Pause all queues
    await Promise.all([
      group.queues.webhook.pause(),
      group.queues.sync.pause(),
      group.queues.guardian.pause(),
      group.queues.alert.pause(),
    ]);

    group.active = false;
    await this.redis.setex(`tenant:${tenantId}:paused`, 86400 * 30, '1');
  }

  /**
   * Resume a tenant's agents
   * Called when: subscription resumed
   */
  async resumeTenant(tenantId: string): Promise<void> {
    const group = this.tenantAgents.get(tenantId);
    if (!group) return;

    await Promise.all([
      group.queues.webhook.resume(),
      group.queues.sync.resume(),
      group.queues.guardian.resume(),
      group.queues.alert.resume(),
    ]);

    group.active = true;
    await this.redis.del(`tenant:${tenantId}:paused`);
  }

  /**
   * Unregister a tenant (cleanup)
   * Called when: account deleted
   */
  async unregisterTenant(tenantId: string): Promise<void> {
    const group = this.tenantAgents.get(tenantId);
    if (!group) return;

    // Close all queues (deletes from Redis)
    await Promise.all([
      group.queues.webhook.close(),
      group.queues.sync.close(),
      group.queues.guardian.close(),
      group.queues.alert.close(),
    ]);

    this.tenantAgents.delete(tenantId);
  }

  /**
   * Get all active tenant IDs
   */
  getActiveTenantIds(): string[] {
    return Array.from(this.tenantAgents.values())
      .filter(g => g.active)
      .map((_, key) => key);
  }
}

interface TenantAgentGroup {
  queues: {
    webhook: Queue;
    sync: Queue;
    guardian: Queue;
    alert: Queue;
  };
  active: boolean;
  createdAt: Date;
}
```

### 4.4 Worker Pool Strategy

**Instead of single workers, use pools that monitor queue depths:**

```typescript
// File: packages/sync-engine/src/worker-pools.ts (NEW)

export class WorkerPool {
  private workers: Map<string, Worker> = new Map();
  private maxWorkers: number;
  private workerConcurrency: number;

  constructor(
    private name: string,
    private queuePattern: string, // e.g., "stockclerk:sync:*"
    private processor: (job: Job) => Promise<void>,
    maxWorkers = 10,
    workerConcurrency = 5
  ) {
    this.maxWorkers = maxWorkers;
    this.workerConcurrency = workerConcurrency;
  }

  /**
   * Dynamically start/stop workers based on queue depth
   */
  async autoScale(): Promise<void> {
    // Every 10 seconds, check all tenant queues
    setInterval(async () => {
      const tenantIds = getTenantManager().getActiveTenantIds();

      for (const tenantId of tenantIds) {
        const queueName = `${this.queuePattern.replace('*', tenantId)}`;
        const waitingCount = await getQueue(queueName).getWaitingCount();

        // Scale up if queue has pending jobs
        if (waitingCount > 0 && this.workers.size < this.maxWorkers) {
          this.startWorker(tenantId);
        }

        // Scale down if queue is empty and worker idle
        if (waitingCount === 0 && this.workers.has(tenantId)) {
          this.stopWorker(tenantId);
        }
      }
    }, 10000);
  }

  private startWorker(tenantId: string): void {
    if (this.workers.has(tenantId)) return;

    const queueName = `${this.queuePattern.replace('*', tenantId)}`;
    const worker = new Worker(queueName, this.processor, {
      connection: this.redis,
      concurrency: this.workerConcurrency,
    });

    this.workers.set(tenantId, worker);
    console.log(`[${this.name}] Started worker for ${tenantId}`);
  }

  private stopWorker(tenantId: string): void {
    const worker = this.workers.get(tenantId);
    if (!worker) return;

    worker.close();
    this.workers.delete(tenantId);
    console.log(`[${this.name}] Stopped worker for ${tenantId}`);
  }
}

// Initialize pools at startup
const webhookPool = new WorkerPool(
  'WebhookPool',
  'stockclerk:webhook:*',
  processWebhookJob,
  maxWorkers = 20,  // Max 20 webhook workers
  concurrency = 5
);

const syncPool = new WorkerPool(
  'SyncPool',
  'stockclerk:sync:*',
  processSyncJob,
  maxWorkers = 15,
  concurrency = 3
);

const alertPool = new WorkerPool(
  'AlertPool',
  'stockclerk:alert:*',
  processAlertJob,
  maxWorkers = 10,
  concurrency = 2
);

// Start auto-scaling
webhookPool.autoScale();
syncPool.autoScale();
alertPool.autoScale();
```

### 4.5 Distributed Event Bus

**Before:** Single in-memory EventBus (EventEmitter3)
```typescript
// Lost if process restarts
// Not shared across multiple backend processes
// No persistence
this.eventBus.emit('sync:completed', event);
```

**After:** Redis Pub/Sub + Local Replay

```typescript
// File: packages/sync-engine/src/distributed-event-bus.ts (NEW)

export class DistributedEventBus extends EventEmitter {
  private redis: Redis;
  private pubRedis: Redis;
  private tenantId: string;

  constructor(tenantId: string, redisUrl: string) {
    super();
    this.tenantId = tenantId;
    this.redis = new Redis(redisUrl);
    this.pubRedis = new Redis(redisUrl);
  }

  /**
   * Emit event to Redis for other services/tenants to subscribe
   */
  async emit(eventType: string, payload: any): Promise<void> {
    const event = {
      tenantId: this.tenantId,
      type: eventType,
      payload,
      timestamp: new Date().toISOString(),
    };

    // Publish to Redis channel
    await this.pubRedis.publish(
      `stockclerk:events:${this.tenantId}`,
      JSON.stringify(event)
    );

    // Also emit locally for in-process subscribers
    super.emit(eventType, event);
  }

  /**
   * Subscribe to Redis-distributed events
   */
  subscribe(eventType: string, handler: (event: any) => void): void {
    const channel = `stockclerk:events:${this.tenantId}`;

    // Subscribe to Redis channel
    this.redis.on('message', (ch, msg) => {
      if (ch === channel) {
        const event = JSON.parse(msg);
        if (event.type === eventType) {
          handler(event);
        }
      }
    });

    this.redis.subscribe(channel);
  }
}
```

### 4.6 New SyncEngine Architecture

**File: Modified `/packages/sync-engine/src/engine.ts`**

```typescript
export interface SyncEngineConfig {
  redisUrl: string;
  // ... existing config

  // NEW: Tenant management
  enablePerTenantIsolation: boolean;
  tenantConcurrency: number; // Max agents per tenant
}

export class SyncEngine {
  private tenantAgents: Map<string, TenantSyncEngine> = new Map();
  private tenantManager: TenantAgentManager;
  private workerPools: WorkerPools;

  /**
   * Start engine with per-tenant isolation
   */
  async start(): Promise<void> {
    if (this.config.enablePerTenantIsolation) {
      // NEW MODE: Per-tenant agents
      this.tenantManager = new TenantAgentManager(this.redis);
      this.workerPools = new WorkerPools(this.redis);

      // Register all active tenants
      const tenantIds = await this.deps.getAllTenantIds();
      for (const tenantId of tenantIds) {
        await this.registerTenant(tenantId);
      }

      // Start worker auto-scaling
      this.workerPools.startAutoScaling();

      console.log(`[SyncEngine] Started with per-tenant isolation for ${tenantIds.length} tenants`);
    } else {
      // OLD MODE: Monolithic (for backwards compatibility)
      this.watcherAgent = createWatcherAgent({...});
      // ... rest of current code
    }
  }

  /**
   * Register a new tenant
   */
  private async registerTenant(tenantId: string): Promise<void> {
    const tenantEngine = new TenantSyncEngine(
      tenantId,
      this.redis,
      this.config,
      this.deps
    );

    await tenantEngine.initialize();
    this.tenantAgents.set(tenantId, tenantEngine);
  }
}

/**
 * Per-tenant sync engine
 * One instance per active tenant
 */
class TenantSyncEngine {
  private queues: {
    webhook: Queue;
    sync: Queue;
    guardian: Queue;
    alert: Queue;
  };

  private eventBus: DistributedEventBus;

  constructor(
    private tenantId: string,
    private redis: Redis,
    private config: SyncEngineConfig,
    private deps: SyncEngineDependencies
  ) {}

  async initialize(): Promise<void> {
    // Create tenant-specific queues
    this.queues = {
      webhook: new Queue(`stockclerk:webhook:${this.tenantId}`, { connection: this.redis }),
      sync: new Queue(`stockclerk:sync:${this.tenantId}`, { connection: this.redis }),
      guardian: new Queue(`stockclerk:guardian:${this.tenantId}`, { connection: this.redis }),
      alert: new Queue(`stockclerk:alert:${this.tenantId}`, { connection: this.redis }),
    };

    // Create distributed event bus
    this.eventBus = new DistributedEventBus(this.tenantId, this.config.redisUrl);

    // Seed recurring guardian job
    await this.queues.guardian.add('reconcile', { tenantId: this.tenantId }, {
      repeat: { every: 15 * 60 * 1000 },
    });
  }
}
```

### 4.7 Backend Integration (Per-Tenant Mode)

**File: Modified `/packages/backend/src/sync-integration.ts`**

```typescript
// Create global engine with per-tenant isolation
const syncEngine = createSyncEngine(config, syncEngineDependencies);

// When tenant signs up:
async function handleTenantSignup(tenantId: string): Promise<void> {
  // 1. Create database records (existing code)
  const tenant = await createTenant({...});

  // 2. NEW: Register with sync engine for agent setup
  await syncEngine.registerTenant(tenantId);

  console.log(`Tenant ${tenantId} registered with sync engine`);
}

// When subscription paused:
async function handleSubscriptionPaused(tenantId: string): Promise<void> {
  await syncEngine.pauseTenant(tenantId);
  console.log(`Tenant ${tenantId} agents paused`);
}

// When subscription resumed:
async function handleSubscriptionResumed(tenantId: string): Promise<void> {
  await syncEngine.resumeTenant(tenantId);
  console.log(`Tenant ${tenantId} agents resumed`);
}

// When account deleted:
async function handleAccountDeleted(tenantId: string): Promise<void> {
  await syncEngine.unregisterTenant(tenantId);
  console.log(`Tenant ${tenantId} agents cleaned up`);
}
```

---

## Part 5: Scaling Strategy by Phase

### Phase 1: Launch → 10 Tenants (Current)

**Architecture:** Monolithic (no changes needed)

```
Backend: 1 instance
├─ SyncEngine
│  ├─ Watcher Agent
│  ├─ Sync Agent
│  ├─ Guardian Agent
│  └─ Alert Agent
└─ Queue Workers
   ├─ Webhook (concurrency: 10)
   ├─ Sync (concurrency: 5)
   └─ Alert (concurrency: 3)

Redis: 1 instance (512 MB)
DB: 1 Postgres instance
```

**Cost:**
- Backend: $10/mo (hobby tier)
- Redis: $5/mo (hobby tier)
- Postgres: Included
- **Total: ~$15/mo**

**Deployment:**
```yaml
# railway.yaml
services:
  backend:
    build: ./packages/backend
    variables:
      ENABLE_PER_TENANT_ISOLATION: "false"

  redis:
    image: redis:7-alpine

  postgres:
    image: postgres:15-alpine
```

---

### Phase 2: 10-50 Tenants (Growth)

**Trigger:** Guardian reconciliation > 10 sec, queue backlog > 50 jobs

**Architecture:** Monolithic + optimizations

**Changes:**

1. **Increase concurrency**
   ```typescript
   registerWebhookWorker(processor, concurrency = 20);
   registerSyncWorker(processor, concurrency = 10);
   registerAlertWorker(processor, concurrency = 5);
   ```

2. **Queue per-tenant reconciliation jobs** (instead of polling)
   ```typescript
   // Instead of nested loop in timer
   // Queue individual reconciliation jobs that run in parallel
   registerGuardianWorker(processor, concurrency = 10);
   ```

3. **Add distributed lock for multi-backend**
   ```typescript
   // Prevents guardian from running on all backends simultaneously
   // Uses Redis lock with 60-second TTL
   ```

4. **Scale horizontally**
   ```yaml
   services:
     backend:
       replicas: 2
       resources:
         memory: 512 MB
         cpu: 1
   ```

**Cost:**
- Backend: $20/mo (2 × growth tier)
- Redis: $10/mo (growth tier, 2GB)
- Postgres: $15/mo (growth tier)
- **Total: ~$45/mo**

**Monitoring:**
- Guardian execution time
- Queue wait time p99
- Worker utilization
- Memory per instance

---

### Phase 3: 50-200 Tenants (Scale)

**Trigger:** Queue backlog > 200, worker CPU > 80%, Guardian > 30 sec

**Architecture:** Per-tenant agent isolation + worker pools

**Full Implementation:**

1. **Deploy per-tenant queues**
   ```typescript
   // One set of queues per tenant instead of global
   stockclerk:webhook:tenant_001
   stockclerk:sync:tenant_001
   stockclerk:guardian:tenant_001
   stockclerk:alert:tenant_001
   ```

2. **Implement worker pools with auto-scaling**
   ```typescript
   // Each pool monitors tenant queues and spawns workers dynamically
   webhookPool.startAutoScaling();  // Max 20 workers
   syncPool.startAutoScaling();      // Max 15 workers
   alertPool.startAutoScaling();     // Max 10 workers
   ```

3. **Distributed event bus**
   ```typescript
   // Replace EventEmitter3 with Redis Pub/Sub
   eventBus.emit('sync:completed', event);
   // Distributed to all backends and stored in Redis
   ```

4. **Separate worker service**
   ```yaml
   services:
     backend:
       replicas: 2
       resources:
         memory: 256 MB

     workers:
       image: stockclerk:backend-worker
       replicas: 5  # Auto-scaled based on queue depth
       resources:
         memory: 512 MB
   ```

**Cost:**
- Backend: $20/mo (2 instances)
- Workers: $50-100/mo (5-10 instances, variable)
- Redis: $20/mo (cluster mode, 5GB)
- Postgres: $25/mo (standard)
- **Total: ~$120-150/mo**

**Benefits:**
- Tenant isolation: One tenant's spike doesn't affect others
- Per-tenant concurrency controls
- Easy to pause/resume tenants
- Scales linearly with tenant count

---

### Phase 4: 200+ Tenants (Enterprise)

**Architecture:** Per-tenant agents + distributed infrastructure

**Advanced Features:**

1. **Tenant-specific resource limits**
   ```typescript
   interface TenantConfig {
     webhookConcurrency: 10;
     syncConcurrency: 5;
     alertConcurrency: 3;
     monthlyJobBudget: 1000000;  // Rate limiting
     maxQueueDepth: 10000;        // Circuit breaker
   }
   ```

2. **Separate queue Redis cluster**
   ```yaml
   services:
     redis-queues:
       image: redis-sentinel
       replicas: 3  # High availability
       storage: 20GB

     redis-cache:
       image: redis:7
       replicas: 2
       storage: 10GB
   ```

3. **Dedicated guardian service**
   ```typescript
   // Guardian runs on its own service
   // Processes reconciliation jobs separately from webhooks/sync
   // Can be scaled independently
   ```

4. **Messaging layer** (for high-volume scenarios)
   ```typescript
   // Add message broker (Kafka/RabbitMQ) instead of pure Redis
   // For tenants with 100+ webhooks/minute
   ```

**Cost:**
- Backend: $30-50/mo
- Workers (variable): $100-500/mo
- Redis cluster: $50-100/mo
- Postgres (cluster): $50-100/mo
- Message broker: $30-50/mo
- **Total: ~$250-800/mo depending on tenant mix**

---

## Part 6: Implementation Roadmap

### Step 0: Baseline Instrumentation (Week 1)

**Prepare to measure scaling limits:**

```typescript
// packages/backend/src/monitoring.ts (NEW)

export interface ScalingMetrics {
  // Guardian
  guardianExecutionTimeMs: number;
  guardianTenantsProcessed: number;

  // Queues
  webhookQueueDepth: number;
  syncQueueDepth: number;
  alertQueueDepth: number;

  // Workers
  webhookWorkerUtilization: number; // 0-1
  syncWorkerUtilization: number;
  alertWorkerUtilization: number;

  // System
  memoryUsageMB: number;
  redisMemoryMB: number;
  activeConnections: number;
}

export function collectMetrics(): ScalingMetrics {
  // Collect from queues, workers, system
  // Send to monitoring service
}

// Every 30 seconds
setInterval(() => {
  const metrics = collectMetrics();
  sendToMonitoring(metrics); // DataDog, New Relic, etc.
}, 30000);
```

**Dashboard queries:**
- Guardian execution time trend
- Queue depth by type
- Worker saturation over time
- Memory growth pattern

---

### Step 1: Prepare Phase 2 Optimizations (Week 2-3)

**Before hitting scaling limits:**

1. **Increase concurrency** (low-risk)
2. **Add distributed lock for Guardian** (medium-risk)
3. **Test with 50-tenant load** (local k8s or staging)

```typescript
// packages/sync-integration.ts - add distributed lock

import Lock from 'ioredis-lock';

export async function startGuardianSchedule(): void {
  const redisConn = getRedisConnection();
  const lock = new Lock(redisConn, 'guardian:reconciliation:lock', 60000);

  reconciliationInterval = setInterval(async () => {
    const acquired = await lock.acquire();
    if (!acquired) {
      console.log('[Guardian] Another backend holds lock, skipping');
      return;
    }

    try {
      // Existing reconciliation logic
      await runReconciliation();
    } finally {
      await lock.release();
    }
  }, 15 * 60 * 1000);
}
```

---

### Step 2: Deploy Phase 2 Infrastructure (Week 4)

**In production:**

```yaml
# railway.yaml
services:
  backend:
    replicas: 2
    resources:
      memory: 512MB
      cpu: 1

  redis:
    image: redis:7
    resources:
      memory: 2GB

  postgres:
    image: postgres:15
    resources:
      memory: 1GB
      storage: 50GB
```

**Testing:**
- Load test with 30 tenants × 20 webhooks/min
- Verify Guardian completes < 15 sec
- Verify p99 latency < 5 sec

---

### Step 3: Develop Phase 3 (Per-Tenant) (Week 5-8)

**In parallel with Phase 2 production:**

Develop new components:
- `TenantAgentManager` (register/pause/resume tenants)
- `WorkerPool` (auto-scaling based on queue depth)
- `DistributedEventBus` (Redis Pub/Sub replacement)
- Modified `SyncEngine` with isolation flag

**Branch:** `feature/per-tenant-isolation`

**Tests:**
- Unit tests for TenantAgentManager
- Integration tests with mock tenants
- Load test 100+ tenants in staging

---

### Step 4: Deploy Phase 3 (Week 9)

**Gradual rollout:**

1. **Feature flag for per-tenant isolation**
   ```typescript
   export const ENABLE_PER_TENANT_ISOLATION = process.env.ENABLE_PER_TENANT_ISOLATION === 'true';
   ```

2. **Deploy to staging first**
   ```yaml
   services:
     backend:
       environment:
         ENABLE_PER_TENANT_ISOLATION: "true"
   ```

3. **Test with real customer data** (anonymized)
4. **Canary rollout:** 10% of production traffic
5. **Full production rollout**

---

## Part 7: Cost Analysis by Scenario

### Scenario A: 1-10 Tenants

| Component | Cost | Notes |
|-----------|------|-------|
| Backend | $5-10 | Hobby tier, shared instance |
| Redis | $5 | Hobby tier, 128MB |
| Postgres | Included | Free tier |
| **Total** | **~$10-15/mo** | Very lean |

---

### Scenario B: 10-50 Tenants

| Component | Cost | Notes |
|-----------|------|-------|
| Backend | $20-30 | 2 growth tier instances |
| Redis | $10-15 | Growth tier, 2GB |
| Postgres | $15-20 | Growth tier |
| Monitoring | $5-10 | DataDog/New Relic |
| **Total** | **~$50-75/mo** | Scale with monolithic |

---

### Scenario C: 50-200 Tenants (Per-Tenant)

| Component | Cost | Notes |
|-----------|------|-------|
| Backend | $20-30 | 2 standard instances |
| Workers | $60-150 | 5-10 auto-scaled instances, $10-15 each |
| Redis (queues) | $30-50 | Cluster mode, 5GB |
| Redis (cache) | $10-20 | Separate instance |
| Postgres | $30-50 | Standard tier + replicas |
| Monitoring | $20-50 | Log aggregation, metrics |
| **Total** | **~$170-350/mo** | Scales better per tenant |

---

### Scenario D: 200+ Tenants (Enterprise)

| Component | Cost | Notes |
|-----------|------|-------|
| Backend | $50-100 | 4-6 instances |
| Workers | $200-500 | 20-50 auto-scaled instances |
| Redis cluster | $80-150 | Multi-zone, HA |
| Message broker | $50-100 | Kafka or RabbitMQ |
| Postgres | $100-200 | Multi-replica, backups |
| Monitoring | $50-100 | Comprehensive observability |
| CDN | $20-50 | For assets |
| **Total** | **~$550-1100/mo** | Enterprise pricing |

---

## Part 8: Decision Tree

**When should Luke implement each phase?**

### Phase 1 → Phase 2
**Trigger:** ANY of these
- [ ] Guardian execution time > 10 seconds
- [ ] Webhook queue has >50 pending jobs during peak hour
- [ ] Memory usage > 400 MB on single backend
- [ ] Database queries for reconciliation taking > 5 seconds

**Action:** Increase worker concurrency, add distributed lock, deploy 2 backends

---

### Phase 2 → Phase 3
**Trigger:** ANY of these
- [ ] Guardian execution time > 30 seconds (can't finish before next cycle)
- [ ] Webhook queue has >200 pending jobs regularly
- [ ] Sync worker CPU > 80% consistently
- [ ] Customer complaints about slow syncs
- [ ] Approaching 50 tenants with growing activity

**Action:** Implement per-tenant isolation, deploy worker pools, switch to distributed event bus

---

### Phase 3 → Phase 4
**Trigger:** ANY of these
- [ ] Approaching 200+ tenants with 500+ webhooks/minute total
- [ ] Redis memory > 5 GB
- [ ] Worker auto-scaling hitting max instances consistently
- [ ] Customer-specific performance SLAs required

**Action:** Add message broker, split Redis into queue/cache clusters, implement tenant rate limiting

---

## Part 9: Testing Strategy

### Before Phase 2
```bash
# Load test: 30 tenants, 20 webhooks/min each
npm run test:load -- --tenants 30 --webhook-rate 20

# Expected results:
# - Guardian execution: < 15 sec
# - Queue p99 latency: < 5 sec
# - Memory: < 500 MB
# - CPU: < 70%
```

### Before Phase 3
```bash
# Load test: 100 tenants, 50 webhooks/min total (variable)
npm run test:load -- --tenants 100 --webhook-rate 50 --isolation true

# Expected results:
# - Per-tenant latency consistent regardless of peak
# - Auto-scaling spawns 5-10 workers
# - No cross-tenant interference
```

---

## Part 10: Migration Guide (Phase 2 → Phase 3)

### No downtime migration:

**Step 1: Deploy Phase 3 code with flag OFF**
```typescript
// Code is there, but not active
ENABLE_PER_TENANT_ISOLATION=false
```

**Step 2: Activate for test tenant**
```typescript
// Create test tenant with isolation enabled
// Monitor for 24 hours
ENABLE_PER_TENANT_ISOLATION=true (for tenant_test_001 only)
```

**Step 3: Canary rollout**
```typescript
// Gradually increase percentage
ENABLE_PER_TENANT_ISOLATION=true (for 10% of tenants)
// Monitor metrics
// If good, increase to 50%, then 100%
```

**Step 4: Cleanup (remove monolithic code)**
```typescript
// After 2 weeks with 100% on isolation:
// Remove monolithic SyncEngine code
// Simplify backend (no need for global workers)
```

---

## Summary & Recommendations

### For Luke (Current - 10 Tenants):
**✓ Ship current monolithic architecture**
- It's perfect for the launch phase
- Add basic monitoring (queue depth, Guardian time)
- No optimization needed yet

### At 10-20 Tenants:
**✓ Prepare Phase 2**
- Add distributed lock to Guardian
- Increase worker concurrency to (20, 10, 5)
- Deploy 2 backends (with load balancer)
- Cost increase: ~$30-40/mo

### At 30-50 Tenants:
**⚠ Decision point**
- Option A: Continue optimizing monolithic (diminishing returns)
- Option B: Begin Phase 3 development
- Recommendation: Start Phase 3 development in parallel with production Phase 2

### At 50-100 Tenants:
**⚠ Must implement Phase 3 (Per-Tenant)**
- Monolithic architecture will be saturated
- Per-tenant isolation enables horizontal scaling
- Cost increase: ~$100-150/mo, but enables 10x growth

### At 100+ Tenants:
**✓ Phase 3 fully operational**
- Auto-scaling workers handling variable load
- Per-tenant resource controls
- Distributed event bus
- Clear path to enterprise scale

---

## Files to Create/Modify

### New Files (Phase 3):
```
packages/sync-engine/src/
├─ tenant-manager.ts           (NEW - TenantAgentManager class)
├─ worker-pools.ts              (NEW - WorkerPool class)
├─ distributed-event-bus.ts     (NEW - DistributedEventBus class)
└─ tenant-sync-engine.ts        (NEW - TenantSyncEngine class)

packages/backend/src/
├─ monitoring.ts                (NEW - Metrics collection)
└─ tenant-lifecycle.ts          (NEW - Signup/pause/resume handlers)
```

### Modified Files:
```
packages/sync-engine/src/
├─ engine.ts                    (Add enablePerTenantIsolation flag)
└─ types.ts                     (Add new config options)

packages/backend/src/
├─ sync-integration.ts          (Add distributed lock)
├─ queues/index.ts              (Increase default concurrency)
├─ routes/auth.ts               (Call tenant lifecycle on signup)
└─ routes/billing.ts            (Call tenant pause/resume)
```

---

## References & Inspiration

- **BullMQ Queue Management:** https://docs.bullmq.io
- **Redis Distributed Locks:** https://github.com/luin/ioredis-lock
- **EventEmitter3:** https://github.com/primus/eventemitter3
- **Scaling NodeJS Applications:** https://nodejs.org/en/docs/guides/nodejs-performance-on-single-core/
- **Railway Deployment Best Practices:** https://railway.app/docs

---

## Conclusion

StockClerk's current monolithic agent architecture is **ideal for launch** (1-50 tenants) but hits scaling limits around 50-100 tenants with moderate activity. The per-tenant isolation architecture presented here enables clean, horizontal scaling to 500+ tenants with minimal resource overhead per new customer.

**Key takeaway:** Implement Phase 2 optimizations at 30 tenants, start Phase 3 development at 40 tenants, and deploy Phase 3 by 60 tenants. This prevents any production incidents and keeps the system performant at every scale.
