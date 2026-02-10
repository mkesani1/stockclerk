# StockClerk Scalability: Quick Start Guide

## TL;DR

Your current monolithic agent system is **perfect for launch** but needs architectural changes at ~50 tenants. Here's the timeline:

| Phase | Tenants | Status | Action | Cost |
|-------|---------|--------|--------|------|
| **Now** | 1-10 | ✓ Ready | Ship it | ~$15/mo |
| **Phase 2** | 10-50 | Work at 30 tenants | Optimize monolithic | ~$50/mo |
| **Phase 3** | 50-200 | Required at 50 tenants | Per-tenant isolation | ~$150/mo |
| **Phase 4** | 200+ | Required at 200+ tenants | Enterprise infrastructure | ~$500+/mo |

---

## Current System (Monolithic)

**How it works:**
```
One SyncEngine instance (in backend process)
├─ Watcher Agent (webhook processing)
├─ Sync Agent (multi-channel updates)
├─ Guardian Agent (15-min reconciliation)
└─ Alert Agent (stock checks)

All tenants share:
- Single Redis connection
- Global queues (stockclerk:webhook, stockclerk:sync, etc.)
- Global workers (10 webhook, 5 sync, 3 alert)
- Single event bus
```

**When new tenant signs up:**
- No new agents spin up
- Jobs go into shared global queues
- Same workers process all tenants
- Guardian includes them in 15-min loop

---

## Scaling Limits

### Phase 2 Scaling (10-50 tenants):

**Monitor these metrics:**
- [ ] Guardian execution time (must stay < 15 sec)
- [ ] Webhook queue depth (alert if > 50 pending)
- [ ] Worker CPU (alert if > 60%)
- [ ] Memory usage (alert if > 400 MB)

**When to trigger Phase 2:**
- Guardian takes >10 seconds
- Webhook queue piles up during peaks
- CPU hits 60-70% consistently

**Phase 2 changes (low-risk, ~1 week):**
1. Increase worker concurrency to (20, 10, 5)
2. Add distributed lock to Guardian (for multi-backend)
3. Deploy 2nd backend instance
4. Cost: +$30-40/mo

### Phase 3 Scaling (50-200 tenants):

**Must implement before 50 tenants if:**
- Guardian can't finish in 15 minutes (>30 sec execution)
- Queue backlog > 200 jobs regularly
- High-activity tenant starving low-activity ones

**Phase 3 changes (major rewrite, ~4 weeks):**
1. Per-tenant queues instead of global
2. Auto-scaling worker pools
3. Distributed event bus (Redis Pub/Sub)
4. Tenant lifecycle management
5. Cost: +$100/mo, but scales to 200+ tenants

---

## Key Code Locations

### Current Architecture:

**Monolithic orchestrator:**
- `/packages/sync-engine/src/engine.ts` - Main SyncEngine class

**Individual agents:**
- `/packages/sync-engine/src/agents/watcher.ts` - Webhook processing
- `/packages/sync-engine/src/agents/sync.ts` - Multi-channel sync
- `/packages/sync-engine/src/agents/guardian.ts` - Reconciliation
- `/packages/sync-engine/src/agents/alert.ts` - Alerting

**Backend integration:**
- `/packages/backend/src/sync-integration.ts` - Dependencies, processors, Guardian schedule
- `/packages/backend/src/queues/index.ts` - Global queue setup & workers

**Tenant handling:**
- `/packages/backend/src/routes/dashboard.ts` - Agent status per tenant (in-memory)

### No per-tenant code currently:

The system iterates through ALL tenants in:
- Guardian reconciliation loop (every 15 min)
- Database queries (filtered by tenantId)
- Queue job processing (tenantId in job data)

---

## What to Do Now (Phase 1)

### 1. Add Monitoring (Week 1)

Create `/packages/backend/src/monitoring.ts`:

```typescript
export interface ScalingMetrics {
  guardianExecutionTimeMs: number;
  webhookQueueDepth: number;
  syncQueueDepth: number;
  memoryUsageMB: number;
  workerUtilization: number; // 0-1
}

export function collectMetrics(): ScalingMetrics {
  // Collect metrics from queues, system, workers
  return { /* ... */ };
}

// Report every 30 seconds
setInterval(() => {
  const m = collectMetrics();
  console.log(`[Metrics] Guardian: ${m.guardianExecutionTimeMs}ms, Queue: ${m.webhookQueueDepth}`);
}, 30000);
```

### 2. Create Scaling Checklist

```markdown
## Scaling Decision Checklist

- [ ] Current tenants: ___
- [ ] Peak webhooks per minute: ___
- [ ] Guardian execution time: ___ ms
- [ ] Webhook queue depth at peak: ___
- [ ] Memory usage: ___ MB
- [ ] CPU usage: ___ %

### Trigger Phase 2?
- [ ] Guardian > 10 sec?
- [ ] Queue > 50 jobs?
- [ ] CPU > 60%?
- [ ] Memory > 400 MB?

If any YES → Implement Phase 2
```

### 3. Document Current Behavior

With 1-10 tenants and LGHP, you should see:
- Guardian execution: < 1 second
- Memory: 100-200 MB
- Queue depth: 0-2 jobs
- CPU: < 10%

If numbers are different, file an issue or adjust expectations.

---

## Transition Guide: Phase 2 → Phase 3

When you hit scaling limits (50 tenants), here's the plan:

### Week 1-2: Prepare Phase 3 code
- Create `TenantAgentManager` class
- Create `WorkerPool` class
- Create `DistributedEventBus` class
- Write tests for new components
- Branch: `feature/per-tenant-isolation`

### Week 3: Deploy to staging
- Deploy Phase 3 code with flag OFF
- Verify existing behavior unchanged
- Load test with 100 mock tenants
- Fix any issues

### Week 4: Canary to production
- Feature flag: `ENABLE_PER_TENANT_ISOLATION=false` (default)
- Deploy to 10% of tenants
- Monitor for 12 hours
- Increase to 50%, then 100%

### Week 5: Cleanup
- Remove monolithic agent code
- Simplify backend (no need for global workers)
- Celebrate! 🎉

---

## When to Implement Each Phase

### Phase 1 → Phase 2: AT 30 TENANTS
- Start Phase 2 work immediately
- Don't wait until bottleneck hits

### Phase 2 → Phase 3: AT 40-50 TENANTS
- Begin Phase 3 development
- Guardian is getting slow (but still working)
- Workers are hitting capacity

### Never let production hit limits:
- Don't scale to 50 tenants on monolithic
- Don't scale to 100 tenants on Phase 2
- Plan architecture changes 2-4 weeks in advance

---

## Cost Timeline

```
Tenants | Phase | Monthly Cost | What's Happening
--------|-------|--------------|------------------
1-10    | 1     | $15-20       | Monolithic, all-in-one
10-30   | 1     | $15-20       | Still monolithic
30-40   | 2     | $50-75       | Optimizing monolithic (2 backends)
40-50   | 2→3   | $75-100      | Transition happening
50-100  | 3     | $150-200     | Per-tenant isolated
100-200 | 3     | $200-300     | Scaling workers
200-500 | 4     | $500-1000    | Enterprise features
```

---

## Red Flags: When to Pause & Re-Architect

🚨 **If you see any of these, stop and implement next phase:**

1. **Guardian reconciliation takes > 30 seconds**
   - Can't finish before next cycle starts
   - Cascading delays
   - → Must implement Phase 3

2. **Webhook queue regularly has > 200 pending jobs**
   - Workers can't keep up
   - Latency: 5-30 minutes for webhooks
   - → Must implement Phase 3

3. **Memory usage > 800 MB and growing**
   - Leaked connections or objects
   - Or genuinely hitting process limits
   - → Add monitoring, then scale

4. **One tenant's spike affects all others**
   - High-activity customer slows everyone
   - → Need tenant isolation (Phase 3)

5. **Worker concurrency maxed out**
   - All workers busy all the time
   - Can't increase further (diminishing returns)
   - → Need worker pools (Phase 3)

---

## Files to Monitor

Add to your CI/CD monitoring:

| File | What to Watch |
|------|---------------|
| `/packages/sync-engine/src/engine.ts` | Monolithic vs isolated mode |
| `/packages/backend/src/sync-integration.ts` | Guardian schedule, worker registration |
| `/packages/backend/src/queues/index.ts` | Queue config, worker concurrency |
| `/packages/sync-engine/src/agents/guardian.ts` | Reconciliation logic (nested loops) |

---

## Questions to Ask Yourself

### At 20 tenants:
- "Is the system still performing well?"
- "Are there any early warning signs?"

### At 30-40 tenants:
- "Should I start Phase 2 optimizations?"
- "Do I have 2-3 weeks to refactor before it matters?"

### At 50 tenants:
- "Can I hold at Phase 2 or must I do Phase 3?"
- "What's my customer growth forecast?"

---

## Next Steps

1. **Add monitoring** (Week 1)
   - Collect Guardian execution time
   - Track queue depths
   - Log worker utilization

2. **Document baseline** (Day 1)
   - Record current metrics with LGHP
   - Create Slack alert for Phase 2 triggers

3. **Plan ahead** (Week 4-6)
   - At 20 tenants, start thinking about Phase 2
   - At 30 tenants, begin Phase 2 work
   - At 40 tenants, start Phase 3 design

4. **Test regularly** (Monthly)
   - Load test with N × 2 tenants
   - Verify response times
   - Check resource usage

---

## Key Insights

✅ **Your current architecture is great for:**
- Early-stage companies (1-50 tenants)
- Simple deployment (1 backend process)
- Easy debugging (all agents in memory)
- Cost-effective (shared infrastructure)

❌ **It breaks at:**
- >50 tenants with variable activity
- High-activity customers (multiple channels, 100+ products)
- Need for per-tenant performance isolation
- High availability (no redundancy)

✨ **Per-tenant isolation gives:**
- Horizontal scaling (add tenants without slowdown)
- Customer isolation (noisy neighbor problem solved)
- Resource controls (throttle misbehaving tenants)
- Easy pause/resume (trial expiry, subscription pause)

---

## Summary

**Today (1-10 tenants):** Ship the current architecture. It's perfect.

**At 30 tenants:** Start Phase 2 optimizations. Low-risk changes that buy you time.

**At 50 tenants:** Deploy Phase 3 (per-tenant isolation). Major change but necessary.

**At 200+ tenants:** Enterprise infrastructure with message brokers, distributed systems, etc.

The full scalability document covers all details. This guide is your roadmap.

Good luck, Luke! 🚀
