/**
 * Sync Service Tests
 * Tests multi-channel sync with buffer stock handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Types
interface Product {
  id: string;
  sku: string;
  name: string;
  currentStock: number;
  bufferStock: number;
}

interface Channel {
  id: string;
  type: 'eposnow' | 'wix' | 'deliveroo';
  name: string;
  isActive: boolean;
}

interface ChannelMapping {
  productId: string;
  channelId: string;
  externalId: string;
  externalSku?: string;
}

interface SyncResult {
  channelId: string;
  success: boolean;
  error?: string;
  syncedStock: number;
}

// Mock channel providers
const mockEposnowProvider = {
  updateStock: vi.fn(),
  getStock: vi.fn(),
};

const mockWixProvider = {
  updateInventory: vi.fn(),
  getInventory: vi.fn(),
};

const mockDeliverooProvider = {
  updateAvailability: vi.fn(),
  setItemQuantity: vi.fn(),
};

// SyncService class for testing
class SyncService {
  private providers: Map<string, any>;

  constructor() {
    this.providers = new Map([
      ['eposnow', mockEposnowProvider],
      ['wix', mockWixProvider],
      ['deliveroo', mockDeliverooProvider],
    ]);
  }

  calculateAvailableStock(product: Product): number {
    // Available stock = current stock - buffer stock
    // Never sync negative values
    return Math.max(0, product.currentStock - product.bufferStock);
  }

  async syncToChannel(
    product: Product,
    channel: Channel,
    mapping: ChannelMapping
  ): Promise<SyncResult> {
    if (!channel.isActive) {
      return {
        channelId: channel.id,
        success: false,
        error: 'Channel is inactive',
        syncedStock: 0,
      };
    }

    const availableStock = this.calculateAvailableStock(product);
    const provider = this.providers.get(channel.type);

    if (!provider) {
      return {
        channelId: channel.id,
        success: false,
        error: `No provider found for channel type: ${channel.type}`,
        syncedStock: 0,
      };
    }

    try {
      switch (channel.type) {
        case 'eposnow':
          await provider.updateStock(mapping.externalId, availableStock);
          break;
        case 'wix':
          await provider.updateInventory(mapping.externalId, availableStock);
          break;
        case 'deliveroo':
          await provider.setItemQuantity(mapping.externalId, availableStock);
          await provider.updateAvailability(mapping.externalId, availableStock > 0);
          break;
      }

      return {
        channelId: channel.id,
        success: true,
        syncedStock: availableStock,
      };
    } catch (error) {
      return {
        channelId: channel.id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        syncedStock: 0,
      };
    }
  }

  async syncToAllChannels(
    product: Product,
    channels: Channel[],
    mappings: ChannelMapping[]
  ): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    for (const channel of channels) {
      const mapping = mappings.find((m) => m.channelId === channel.id && m.productId === product.id);

      if (!mapping) {
        results.push({
          channelId: channel.id,
          success: false,
          error: 'No mapping found for this product-channel combination',
          syncedStock: 0,
        });
        continue;
      }

      const result = await this.syncToChannel(product, channel, mapping);
      results.push(result);
    }

    return results;
  }

  async syncFromSourceChannel(
    product: Product,
    sourceChannel: Channel,
    targetChannels: Channel[],
    mappings: ChannelMapping[]
  ): Promise<SyncResult[]> {
    // Sync to all channels except the source
    const channelsToSync = targetChannels.filter((c) => c.id !== sourceChannel.id);
    return this.syncToAllChannels(product, channelsToSync, mappings);
  }
}

describe('SyncService', () => {
  let syncService: SyncService;

  beforeEach(() => {
    syncService = new SyncService();
    vi.clearAllMocks();

    // Setup default mock responses
    mockEposnowProvider.updateStock.mockResolvedValue({ success: true });
    mockWixProvider.updateInventory.mockResolvedValue({ success: true });
    mockDeliverooProvider.setItemQuantity.mockResolvedValue({ success: true });
    mockDeliverooProvider.updateAvailability.mockResolvedValue({ success: true });
  });

  describe('Buffer Stock Calculation', () => {
    it('should calculate available stock correctly', () => {
      const product: Product = {
        id: 'prod-1',
        sku: 'SKU-001',
        name: 'Test Product',
        currentStock: 100,
        bufferStock: 10,
      };

      const available = syncService.calculateAvailableStock(product);

      expect(available).toBe(90);
    });

    it('should return 0 when stock is less than buffer', () => {
      const product: Product = {
        id: 'prod-1',
        sku: 'SKU-001',
        name: 'Test Product',
        currentStock: 5,
        bufferStock: 10,
      };

      const available = syncService.calculateAvailableStock(product);

      expect(available).toBe(0);
    });

    it('should return 0 when stock equals buffer', () => {
      const product: Product = {
        id: 'prod-1',
        sku: 'SKU-001',
        name: 'Test Product',
        currentStock: 10,
        bufferStock: 10,
      };

      const available = syncService.calculateAvailableStock(product);

      expect(available).toBe(0);
    });

    it('should handle zero buffer stock', () => {
      const product: Product = {
        id: 'prod-1',
        sku: 'SKU-001',
        name: 'Test Product',
        currentStock: 50,
        bufferStock: 0,
      };

      const available = syncService.calculateAvailableStock(product);

      expect(available).toBe(50);
    });

    it('should never return negative available stock', () => {
      const product: Product = {
        id: 'prod-1',
        sku: 'SKU-001',
        name: 'Test Product',
        currentStock: 0,
        bufferStock: 10,
      };

      const available = syncService.calculateAvailableStock(product);

      expect(available).toBe(0);
    });
  });

  describe('Single Channel Sync', () => {
    const product: Product = {
      id: 'prod-1',
      sku: 'SKU-001',
      name: 'Test Product',
      currentStock: 100,
      bufferStock: 10,
    };

    it('should sync to Eposnow channel successfully', async () => {
      const channel: Channel = {
        id: 'ch-1',
        type: 'eposnow',
        name: 'Test POS',
        isActive: true,
      };

      const mapping: ChannelMapping = {
        productId: product.id,
        channelId: channel.id,
        externalId: 'epos-123',
      };

      const result = await syncService.syncToChannel(product, channel, mapping);

      expect(result.success).toBe(true);
      expect(result.syncedStock).toBe(90); // 100 - 10 buffer
      expect(mockEposnowProvider.updateStock).toHaveBeenCalledWith('epos-123', 90);
    });

    it('should sync to Wix channel successfully', async () => {
      const channel: Channel = {
        id: 'ch-2',
        type: 'wix',
        name: 'Online Store',
        isActive: true,
      };

      const mapping: ChannelMapping = {
        productId: product.id,
        channelId: channel.id,
        externalId: 'wix-456',
      };

      const result = await syncService.syncToChannel(product, channel, mapping);

      expect(result.success).toBe(true);
      expect(mockWixProvider.updateInventory).toHaveBeenCalledWith('wix-456', 90);
    });

    it('should sync to Deliveroo channel and update availability', async () => {
      const channel: Channel = {
        id: 'ch-3',
        type: 'deliveroo',
        name: 'Delivery App',
        isActive: true,
      };

      const mapping: ChannelMapping = {
        productId: product.id,
        channelId: channel.id,
        externalId: 'del-789',
      };

      const result = await syncService.syncToChannel(product, channel, mapping);

      expect(result.success).toBe(true);
      expect(mockDeliverooProvider.setItemQuantity).toHaveBeenCalledWith('del-789', 90);
      expect(mockDeliverooProvider.updateAvailability).toHaveBeenCalledWith('del-789', true);
    });

    it('should set Deliveroo item as unavailable when stock is 0', async () => {
      const zeroStockProduct: Product = {
        ...product,
        currentStock: 5, // Below buffer
      };

      const channel: Channel = {
        id: 'ch-3',
        type: 'deliveroo',
        name: 'Delivery App',
        isActive: true,
      };

      const mapping: ChannelMapping = {
        productId: zeroStockProduct.id,
        channelId: channel.id,
        externalId: 'del-789',
      };

      await syncService.syncToChannel(zeroStockProduct, channel, mapping);

      expect(mockDeliverooProvider.setItemQuantity).toHaveBeenCalledWith('del-789', 0);
      expect(mockDeliverooProvider.updateAvailability).toHaveBeenCalledWith('del-789', false);
    });

    it('should fail when channel is inactive', async () => {
      const channel: Channel = {
        id: 'ch-1',
        type: 'eposnow',
        name: 'Test POS',
        isActive: false,
      };

      const mapping: ChannelMapping = {
        productId: product.id,
        channelId: channel.id,
        externalId: 'epos-123',
      };

      const result = await syncService.syncToChannel(product, channel, mapping);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Channel is inactive');
      expect(mockEposnowProvider.updateStock).not.toHaveBeenCalled();
    });

    it('should handle provider errors gracefully', async () => {
      mockEposnowProvider.updateStock.mockRejectedValue(new Error('API rate limit exceeded'));

      const channel: Channel = {
        id: 'ch-1',
        type: 'eposnow',
        name: 'Test POS',
        isActive: true,
      };

      const mapping: ChannelMapping = {
        productId: product.id,
        channelId: channel.id,
        externalId: 'epos-123',
      };

      const result = await syncService.syncToChannel(product, channel, mapping);

      expect(result.success).toBe(false);
      expect(result.error).toBe('API rate limit exceeded');
    });
  });

  describe('Multi-Channel Sync', () => {
    const product: Product = {
      id: 'prod-1',
      sku: 'SKU-001',
      name: 'Test Product',
      currentStock: 100,
      bufferStock: 10,
    };

    const channels: Channel[] = [
      { id: 'ch-1', type: 'eposnow', name: 'POS', isActive: true },
      { id: 'ch-2', type: 'wix', name: 'Web', isActive: true },
      { id: 'ch-3', type: 'deliveroo', name: 'Delivery', isActive: true },
    ];

    const mappings: ChannelMapping[] = [
      { productId: product.id, channelId: 'ch-1', externalId: 'epos-123' },
      { productId: product.id, channelId: 'ch-2', externalId: 'wix-456' },
      { productId: product.id, channelId: 'ch-3', externalId: 'del-789' },
    ];

    it('should sync to all channels successfully', async () => {
      const results = await syncService.syncToAllChannels(product, channels, mappings);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
      expect(mockEposnowProvider.updateStock).toHaveBeenCalled();
      expect(mockWixProvider.updateInventory).toHaveBeenCalled();
      expect(mockDeliverooProvider.setItemQuantity).toHaveBeenCalled();
    });

    it('should skip channels without mappings', async () => {
      const partialMappings = mappings.slice(0, 2); // Only eposnow and wix

      const results = await syncService.syncToAllChannels(product, channels, partialMappings);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(results[2].success).toBe(false);
      expect(results[2].error).toContain('No mapping found');
    });

    it('should continue syncing even if one channel fails', async () => {
      mockWixProvider.updateInventory.mockRejectedValue(new Error('Wix API error'));

      const results = await syncService.syncToAllChannels(product, channels, mappings);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true); // eposnow
      expect(results[1].success).toBe(false); // wix
      expect(results[2].success).toBe(true); // deliveroo
    });

    it('should skip inactive channels', async () => {
      const mixedChannels: Channel[] = [
        { id: 'ch-1', type: 'eposnow', name: 'POS', isActive: true },
        { id: 'ch-2', type: 'wix', name: 'Web', isActive: false },
        { id: 'ch-3', type: 'deliveroo', name: 'Delivery', isActive: true },
      ];

      const results = await syncService.syncToAllChannels(product, mixedChannels, mappings);

      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe('Channel is inactive');
      expect(mockWixProvider.updateInventory).not.toHaveBeenCalled();
    });
  });

  describe('Source Channel Exclusion', () => {
    const product: Product = {
      id: 'prod-1',
      sku: 'SKU-001',
      name: 'Test Product',
      currentStock: 100,
      bufferStock: 10,
    };

    const channels: Channel[] = [
      { id: 'ch-1', type: 'eposnow', name: 'POS', isActive: true },
      { id: 'ch-2', type: 'wix', name: 'Web', isActive: true },
      { id: 'ch-3', type: 'deliveroo', name: 'Delivery', isActive: true },
    ];

    const mappings: ChannelMapping[] = [
      { productId: product.id, channelId: 'ch-1', externalId: 'epos-123' },
      { productId: product.id, channelId: 'ch-2', externalId: 'wix-456' },
      { productId: product.id, channelId: 'ch-3', externalId: 'del-789' },
    ];

    it('should not sync back to source channel', async () => {
      const sourceChannel = channels[0]; // eposnow

      const results = await syncService.syncFromSourceChannel(
        product,
        sourceChannel,
        channels,
        mappings
      );

      expect(results).toHaveLength(2);
      expect(results.some((r) => r.channelId === 'ch-1')).toBe(false);
      expect(mockEposnowProvider.updateStock).not.toHaveBeenCalled();
      expect(mockWixProvider.updateInventory).toHaveBeenCalled();
      expect(mockDeliverooProvider.setItemQuantity).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle product with no mappings', async () => {
      const product: Product = {
        id: 'prod-unmapped',
        sku: 'SKU-UNMAPPED',
        name: 'Unmapped Product',
        currentStock: 100,
        bufferStock: 10,
      };

      const channels: Channel[] = [
        { id: 'ch-1', type: 'eposnow', name: 'POS', isActive: true },
      ];

      const results = await syncService.syncToAllChannels(product, channels, []);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('No mapping found');
    });

    it('should handle empty channel list', async () => {
      const product: Product = {
        id: 'prod-1',
        sku: 'SKU-001',
        name: 'Test Product',
        currentStock: 100,
        bufferStock: 10,
      };

      const results = await syncService.syncToAllChannels(product, [], []);

      expect(results).toHaveLength(0);
    });
  });
});
