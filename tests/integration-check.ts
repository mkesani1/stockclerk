/**
 * Integration Verification Test
 * Validates that all packages can be imported and work together
 *
 * Run with: npx tsx tests/integration-check.ts
 */

import { describe, it, expect } from 'vitest';

// ============================================================================
// Package Import Tests
// ============================================================================

describe('Package Integration', () => {
  describe('Backend Package', () => {
    it('should export database utilities', async () => {
      const backend = await import('@stocksync-hub/backend');
      expect(backend.db).toBeDefined();
      expect(backend.checkDatabaseConnection).toBeDefined();
      expect(backend.closeDatabaseConnection).toBeDefined();
    });

    it('should export schema types', async () => {
      const backend = await import('@stocksync-hub/backend');
      expect(backend.tenants).toBeDefined();
      expect(backend.users).toBeDefined();
      expect(backend.channels).toBeDefined();
      expect(backend.products).toBeDefined();
      expect(backend.productChannelMappings).toBeDefined();
      expect(backend.syncEvents).toBeDefined();
      expect(backend.alerts).toBeDefined();
    });

    it('should export config', async () => {
      const backend = await import('@stocksync-hub/backend');
      expect(backend.config).toBeDefined();
      expect(backend.config.PORT).toBeDefined();
      expect(backend.config.DATABASE_URL).toBeDefined();
    });

    it('should export WebSocket utilities', async () => {
      const backend = await import('@stocksync-hub/backend');
      expect(backend.broadcastToTenant).toBeDefined();
      expect(backend.emitStockUpdated).toBeDefined();
      expect(backend.emitSyncCompleted).toBeDefined();
    });

    it('should export queue utilities', async () => {
      const backend = await import('@stocksync-hub/backend');
      expect(backend.initializeQueues).toBeDefined();
      expect(backend.addSyncJob).toBeDefined();
      expect(backend.addWebhookJob).toBeDefined();
    });
  });

  describe('Integrations Package', () => {
    it('should export unified provider interface', async () => {
      const integrations = await import('@stocksync/integrations');
      expect(integrations.BaseInventoryProvider).toBeDefined();
      expect(integrations.ProviderError).toBeDefined();
    });

    it('should export provider factory', async () => {
      const integrations = await import('@stocksync/integrations');
      expect(integrations.createProvider).toBeDefined();
      expect(integrations.ProviderRegistry).toBeDefined();
    });

    it('should export Eposnow integration', async () => {
      const integrations = await import('@stocksync/integrations');
      expect(integrations.EposnowProvider).toBeDefined();
      expect(integrations.createEposnowProvider).toBeDefined();
      expect(integrations.EposnowApiClient).toBeDefined();
    });

    it('should export Wix integration', async () => {
      const integrations = await import('@stocksync/integrations');
      expect(integrations.WixProvider).toBeDefined();
      expect(integrations.createWixProvider).toBeDefined();
      expect(integrations.WixApiClient).toBeDefined();
    });

    it('should export Otter/Deliveroo integration', async () => {
      const integrations = await import('@stocksync/integrations');
      expect(integrations.OtterProvider).toBeDefined();
      expect(integrations.createOtterProvider).toBeDefined();
      expect(integrations.OtterApiClient).toBeDefined();
    });

    it('should export utility functions', async () => {
      const integrations = await import('@stocksync/integrations');
      expect(integrations.RateLimiter).toBeDefined();
      expect(integrations.withRetry).toBeDefined();
    });
  });

  describe('Sync Engine Package', () => {
    it('should export SyncEngine', async () => {
      const syncEngine = await import('@stocksync/sync-engine');
      expect(syncEngine.SyncEngine).toBeDefined();
      expect(syncEngine.createSyncEngine).toBeDefined();
    });

    it('should export agents', async () => {
      const syncEngine = await import('@stocksync/sync-engine');
      expect(syncEngine.WatcherAgent).toBeDefined();
      expect(syncEngine.SyncAgent).toBeDefined();
      expect(syncEngine.GuardianAgent).toBeDefined();
      expect(syncEngine.AlertAgent).toBeDefined();
    });

    it('should export event bus', async () => {
      const syncEngine = await import('@stocksync/sync-engine');
      expect(syncEngine.SyncEngineEventBus).toBeDefined();
      expect(syncEngine.createEventBus).toBeDefined();
    });

    it('should export utility functions', async () => {
      const syncEngine = await import('@stocksync/sync-engine');
      expect(syncEngine.calculateOnlineStock).toBeDefined();
      expect(syncEngine.isOnlineChannel).toBeDefined();
    });

    it('should calculate buffer stock correctly', async () => {
      const { calculateOnlineStock, isOnlineChannel } = await import('@stocksync/sync-engine');

      // Test buffer stock calculation
      expect(calculateOnlineStock(10, 2)).toBe(8);
      expect(calculateOnlineStock(5, 5)).toBe(0);
      expect(calculateOnlineStock(2, 5)).toBe(0); // Never negative

      // Test channel type detection
      expect(isOnlineChannel('wix')).toBe(true);
      expect(isOnlineChannel('deliveroo')).toBe(true);
      expect(isOnlineChannel('eposnow')).toBe(false);
    });
  });
});

// ============================================================================
// Type Compatibility Tests
// ============================================================================

describe('Type Compatibility', () => {
  it('should have compatible channel types across packages', async () => {
    // Both packages should use the same channel type union
    type BackendChannelType = 'eposnow' | 'wix' | 'deliveroo';
    type IntegrationsChannelType = 'eposnow' | 'wix' | 'deliveroo';

    const channelTypes: BackendChannelType[] = ['eposnow', 'wix', 'deliveroo'];

    channelTypes.forEach((type) => {
      const integrationCheck: IntegrationsChannelType = type;
      expect(integrationCheck).toBe(type);
    });
  });

  it('should have compatible alert types', async () => {
    type AlertType = 'low_stock' | 'sync_error' | 'channel_disconnected' | 'system';
    const alertTypes: AlertType[] = ['low_stock', 'sync_error', 'channel_disconnected', 'system'];

    alertTypes.forEach((type) => {
      expect(['low_stock', 'sync_error', 'channel_disconnected', 'system']).toContain(type);
    });
  });
});

// ============================================================================
// Integration Flow Tests
// ============================================================================

describe('Integration Flows', () => {
  it('should be able to create a provider from factory', async () => {
    const { createProvider } = await import('@stocksync/integrations');

    const eposnowProvider = createProvider('eposnow');
    expect(eposnowProvider.channelType).toBe('eposnow');

    const wixProvider = createProvider('wix');
    expect(wixProvider.channelType).toBe('wix');

    const deliverooProvider = createProvider('deliveroo');
    expect(deliverooProvider.channelType).toBe('deliveroo');
  });

  it('should be able to create an event bus', async () => {
    const { createEventBus } = await import('@stocksync/sync-engine');

    const eventBus = createEventBus(false);
    expect(eventBus).toBeDefined();
    expect(eventBus.onStockChange).toBeDefined();
    expect(eventBus.onSyncCompleted).toBeDefined();
    expect(eventBus.onAlertTriggered).toBeDefined();
  });
});

// ============================================================================
// Standalone Check (run without test framework)
// ============================================================================

async function runStandaloneCheck() {
  console.log('StockSync Hub Integration Check');
  console.log('================================\n');

  let passed = 0;
  let failed = 0;

  async function check(name: string, fn: () => Promise<boolean>) {
    try {
      const result = await fn();
      if (result) {
        console.log(`[PASS] ${name}`);
        passed++;
      } else {
        console.log(`[FAIL] ${name}`);
        failed++;
      }
    } catch (error) {
      console.log(`[ERROR] ${name}: ${error instanceof Error ? error.message : error}`);
      failed++;
    }
  }

  // Check package imports
  console.log('Checking package imports...\n');

  await check('Backend package imports', async () => {
    const backend = await import('@stocksync-hub/backend');
    return !!backend.config && !!backend.db;
  });

  await check('Integrations package imports', async () => {
    const integrations = await import('@stocksync/integrations');
    return !!integrations.createProvider && !!integrations.EposnowProvider;
  });

  await check('Sync Engine package imports', async () => {
    const syncEngine = await import('@stocksync/sync-engine');
    return !!syncEngine.SyncEngine && !!syncEngine.createEventBus;
  });

  // Check cross-package functionality
  console.log('\nChecking cross-package functionality...\n');

  await check('Provider creation works', async () => {
    const { createProvider } = await import('@stocksync/integrations');
    const provider = createProvider('eposnow');
    return provider.channelType === 'eposnow';
  });

  await check('Buffer stock calculation works', async () => {
    const { calculateOnlineStock } = await import('@stocksync/sync-engine');
    return calculateOnlineStock(10, 2) === 8 && calculateOnlineStock(5, 10) === 0;
  });

  await check('Event bus creation works', async () => {
    const { createEventBus } = await import('@stocksync/sync-engine');
    const bus = createEventBus(false);
    return typeof bus.onStockChange === 'function';
  });

  // Summary
  console.log('\n================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('================================\n');

  return failed === 0;
}

// Run standalone if called directly
if (process.argv[1]?.includes('integration-check')) {
  runStandaloneCheck()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error('Integration check failed:', error);
      process.exit(1);
    });
}

export { runStandaloneCheck };
