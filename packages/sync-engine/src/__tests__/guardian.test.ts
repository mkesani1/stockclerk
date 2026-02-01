/**
 * Guardian Service Tests
 * Tests drift detection and repair functionality
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

interface ChannelStock {
  channelId: string;
  externalId: string;
  stockLevel: number;
  lastUpdated: Date;
}

interface DriftReport {
  productId: string;
  expectedStock: number;
  channelDrifts: {
    channelId: string;
    channelName: string;
    actualStock: number;
    expectedStock: number;
    drift: number;
    driftPercentage: number;
  }[];
  hasCriticalDrift: boolean;
}

interface RepairAction {
  channelId: string;
  productId: string;
  action: 'update_stock';
  fromStock: number;
  toStock: number;
  success: boolean;
  error?: string;
}

// Mock providers
const mockEposnowProvider = {
  getStock: vi.fn(),
  updateStock: vi.fn(),
};

const mockWixProvider = {
  getInventory: vi.fn(),
  updateInventory: vi.fn(),
};

const mockDeliverooProvider = {
  getItemQuantity: vi.fn(),
  setItemQuantity: vi.fn(),
};

// Guardian Service class for testing
class GuardianService {
  private providers: Map<string, any>;
  private driftThreshold: number;
  private criticalDriftPercentage: number;

  constructor(options: { driftThreshold?: number; criticalDriftPercentage?: number } = {}) {
    this.providers = new Map([
      ['eposnow', mockEposnowProvider],
      ['wix', mockWixProvider],
      ['deliveroo', mockDeliverooProvider],
    ]);
    this.driftThreshold = options.driftThreshold ?? 0;
    this.criticalDriftPercentage = options.criticalDriftPercentage ?? 20;
  }

  async getChannelStock(channel: Channel, mapping: ChannelMapping): Promise<ChannelStock | null> {
    const provider = this.providers.get(channel.type);
    if (!provider) return null;

    try {
      let stockLevel: number;

      switch (channel.type) {
        case 'eposnow':
          stockLevel = await provider.getStock(mapping.externalId);
          break;
        case 'wix':
          stockLevel = await provider.getInventory(mapping.externalId);
          break;
        case 'deliveroo':
          stockLevel = await provider.getItemQuantity(mapping.externalId);
          break;
        default:
          return null;
      }

      return {
        channelId: channel.id,
        externalId: mapping.externalId,
        stockLevel,
        lastUpdated: new Date(),
      };
    } catch {
      return null;
    }
  }

  async detectDrift(
    product: Product,
    channels: Channel[],
    mappings: ChannelMapping[]
  ): Promise<DriftReport> {
    const expectedStock = Math.max(0, product.currentStock - product.bufferStock);
    const channelDrifts: DriftReport['channelDrifts'] = [];

    for (const channel of channels) {
      if (!channel.isActive) continue;

      const mapping = mappings.find(
        (m) => m.productId === product.id && m.channelId === channel.id
      );

      if (!mapping) continue;

      const channelStock = await this.getChannelStock(channel, mapping);
      if (!channelStock) continue;

      const drift = channelStock.stockLevel - expectedStock;
      const driftPercentage = expectedStock > 0
        ? Math.abs(drift / expectedStock) * 100
        : (drift !== 0 ? 100 : 0);

      if (Math.abs(drift) > this.driftThreshold) {
        channelDrifts.push({
          channelId: channel.id,
          channelName: channel.name,
          actualStock: channelStock.stockLevel,
          expectedStock,
          drift,
          driftPercentage,
        });
      }
    }

    const hasCriticalDrift = channelDrifts.some(
      (d) => d.driftPercentage >= this.criticalDriftPercentage
    );

    return {
      productId: product.id,
      expectedStock,
      channelDrifts,
      hasCriticalDrift,
    };
  }

  async repairDrift(
    product: Product,
    channel: Channel,
    mapping: ChannelMapping
  ): Promise<RepairAction> {
    const expectedStock = Math.max(0, product.currentStock - product.bufferStock);
    const channelStock = await this.getChannelStock(channel, mapping);

    if (!channelStock) {
      return {
        channelId: channel.id,
        productId: product.id,
        action: 'update_stock',
        fromStock: 0,
        toStock: expectedStock,
        success: false,
        error: 'Could not fetch current stock from channel',
      };
    }

    const provider = this.providers.get(channel.type);
    if (!provider) {
      return {
        channelId: channel.id,
        productId: product.id,
        action: 'update_stock',
        fromStock: channelStock.stockLevel,
        toStock: expectedStock,
        success: false,
        error: 'No provider found for channel type',
      };
    }

    try {
      switch (channel.type) {
        case 'eposnow':
          await provider.updateStock(mapping.externalId, expectedStock);
          break;
        case 'wix':
          await provider.updateInventory(mapping.externalId, expectedStock);
          break;
        case 'deliveroo':
          await provider.setItemQuantity(mapping.externalId, expectedStock);
          break;
      }

      return {
        channelId: channel.id,
        productId: product.id,
        action: 'update_stock',
        fromStock: channelStock.stockLevel,
        toStock: expectedStock,
        success: true,
      };
    } catch (error) {
      return {
        channelId: channel.id,
        productId: product.id,
        action: 'update_stock',
        fromStock: channelStock.stockLevel,
        toStock: expectedStock,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async repairAllDrifts(
    product: Product,
    channels: Channel[],
    mappings: ChannelMapping[]
  ): Promise<RepairAction[]> {
    const driftReport = await this.detectDrift(product, channels, mappings);
    const repairActions: RepairAction[] = [];

    for (const drift of driftReport.channelDrifts) {
      const channel = channels.find((c) => c.id === drift.channelId);
      const mapping = mappings.find(
        (m) => m.productId === product.id && m.channelId === drift.channelId
      );

      if (!channel || !mapping) continue;

      const action = await this.repairDrift(product, channel, mapping);
      repairActions.push(action);
    }

    return repairActions;
  }
}

describe('GuardianService', () => {
  let guardian: GuardianService;

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
    { productId: 'prod-1', channelId: 'ch-1', externalId: 'epos-123' },
    { productId: 'prod-1', channelId: 'ch-2', externalId: 'wix-456' },
    { productId: 'prod-1', channelId: 'ch-3', externalId: 'del-789' },
  ];

  beforeEach(() => {
    guardian = new GuardianService({ driftThreshold: 0, criticalDriftPercentage: 20 });
    vi.clearAllMocks();

    // Default: all channels in sync
    mockEposnowProvider.getStock.mockResolvedValue(90);
    mockWixProvider.getInventory.mockResolvedValue(90);
    mockDeliverooProvider.getItemQuantity.mockResolvedValue(90);

    mockEposnowProvider.updateStock.mockResolvedValue({ success: true });
    mockWixProvider.updateInventory.mockResolvedValue({ success: true });
    mockDeliverooProvider.setItemQuantity.mockResolvedValue({ success: true });
  });

  describe('Drift Detection', () => {
    it('should detect no drift when all channels are in sync', async () => {
      const report = await guardian.detectDrift(product, channels, mappings);

      expect(report.productId).toBe(product.id);
      expect(report.expectedStock).toBe(90);
      expect(report.channelDrifts).toHaveLength(0);
      expect(report.hasCriticalDrift).toBe(false);
    });

    it('should detect drift when channel stock differs', async () => {
      mockWixProvider.getInventory.mockResolvedValue(80); // 10 units less

      const report = await guardian.detectDrift(product, channels, mappings);

      expect(report.channelDrifts).toHaveLength(1);
      expect(report.channelDrifts[0]).toMatchObject({
        channelId: 'ch-2',
        actualStock: 80,
        expectedStock: 90,
        drift: -10,
      });
    });

    it('should detect positive drift (overselling risk)', async () => {
      mockEposnowProvider.getStock.mockResolvedValue(100); // 10 more than expected

      const report = await guardian.detectDrift(product, channels, mappings);

      expect(report.channelDrifts[0]).toMatchObject({
        channelId: 'ch-1',
        actualStock: 100,
        expectedStock: 90,
        drift: 10,
      });
    });

    it('should detect critical drift above threshold', async () => {
      mockWixProvider.getInventory.mockResolvedValue(50); // ~44% drift

      const report = await guardian.detectDrift(product, channels, mappings);

      expect(report.hasCriticalDrift).toBe(true);
      expect(report.channelDrifts[0].driftPercentage).toBeGreaterThan(20);
    });

    it('should skip inactive channels', async () => {
      const mixedChannels: Channel[] = [
        { id: 'ch-1', type: 'eposnow', name: 'POS', isActive: true },
        { id: 'ch-2', type: 'wix', name: 'Web', isActive: false },
        { id: 'ch-3', type: 'deliveroo', name: 'Delivery', isActive: true },
      ];

      mockWixProvider.getInventory.mockResolvedValue(50); // Would be drift, but inactive

      const report = await guardian.detectDrift(product, mixedChannels, mappings);

      // Only 2 channels checked (eposnow and deliveroo)
      expect(mockWixProvider.getInventory).not.toHaveBeenCalled();
    });

    it('should handle channels without mappings', async () => {
      const partialMappings = mappings.slice(0, 2);

      const report = await guardian.detectDrift(product, channels, partialMappings);

      expect(mockDeliverooProvider.getItemQuantity).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      mockWixProvider.getInventory.mockRejectedValue(new Error('API timeout'));

      const report = await guardian.detectDrift(product, channels, mappings);

      // Should only have results for channels that didn't error
      expect(report.channelDrifts.some((d) => d.channelId === 'ch-2')).toBe(false);
    });
  });

  describe('Drift Repair', () => {
    it('should repair single channel drift', async () => {
      mockEposnowProvider.getStock.mockResolvedValue(80);

      const action = await guardian.repairDrift(product, channels[0], mappings[0]);

      expect(action.success).toBe(true);
      expect(action.fromStock).toBe(80);
      expect(action.toStock).toBe(90);
      expect(mockEposnowProvider.updateStock).toHaveBeenCalledWith('epos-123', 90);
    });

    it('should repair all detected drifts', async () => {
      mockEposnowProvider.getStock.mockResolvedValue(80);
      mockWixProvider.getInventory.mockResolvedValue(70);
      mockDeliverooProvider.getItemQuantity.mockResolvedValue(90); // In sync

      const actions = await guardian.repairAllDrifts(product, channels, mappings);

      expect(actions).toHaveLength(2);
      expect(actions[0].channelId).toBe('ch-1');
      expect(actions[1].channelId).toBe('ch-2');
      expect(mockEposnowProvider.updateStock).toHaveBeenCalledWith('epos-123', 90);
      expect(mockWixProvider.updateInventory).toHaveBeenCalledWith('wix-456', 90);
    });

    it('should handle repair failures gracefully', async () => {
      mockEposnowProvider.getStock.mockResolvedValue(80);
      mockEposnowProvider.updateStock.mockRejectedValue(new Error('Rate limit'));

      const action = await guardian.repairDrift(product, channels[0], mappings[0]);

      expect(action.success).toBe(false);
      expect(action.error).toBe('Rate limit');
    });

    it('should return no actions when no drift detected', async () => {
      const actions = await guardian.repairAllDrifts(product, channels, mappings);

      expect(actions).toHaveLength(0);
    });
  });

  describe('Drift Threshold Configuration', () => {
    it('should ignore small drifts within threshold', async () => {
      const guardianWithThreshold = new GuardianService({
        driftThreshold: 5,
        criticalDriftPercentage: 20,
      });

      mockEposnowProvider.getStock.mockResolvedValue(87); // 3 units drift

      const report = await guardianWithThreshold.detectDrift(product, channels, mappings);

      expect(report.channelDrifts).toHaveLength(0);
    });

    it('should detect drifts above threshold', async () => {
      const guardianWithThreshold = new GuardianService({
        driftThreshold: 5,
        criticalDriftPercentage: 20,
      });

      mockEposnowProvider.getStock.mockResolvedValue(82); // 8 units drift

      const report = await guardianWithThreshold.detectDrift(product, channels, mappings);

      expect(report.channelDrifts).toHaveLength(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle product with zero expected stock', async () => {
      const lowStockProduct: Product = {
        ...product,
        currentStock: 5, // Below buffer
      };

      mockEposnowProvider.getStock.mockResolvedValue(0);
      mockWixProvider.getInventory.mockResolvedValue(0);
      mockDeliverooProvider.getItemQuantity.mockResolvedValue(0);

      const report = await guardian.detectDrift(lowStockProduct, channels, mappings);

      expect(report.expectedStock).toBe(0);
      expect(report.channelDrifts).toHaveLength(0);
    });

    it('should detect drift when expected is zero but channel has stock', async () => {
      const lowStockProduct: Product = {
        ...product,
        currentStock: 5,
      };

      mockEposnowProvider.getStock.mockResolvedValue(5); // Has stock when should be 0

      const report = await guardian.detectDrift(lowStockProduct, channels, mappings);

      expect(report.channelDrifts).toHaveLength(1);
      expect(report.channelDrifts[0].actualStock).toBe(5);
      expect(report.channelDrifts[0].expectedStock).toBe(0);
    });

    it('should handle multiple products drift detection', async () => {
      const products: Product[] = [
        { id: 'prod-1', sku: 'SKU-001', name: 'Product 1', currentStock: 100, bufferStock: 10 },
        { id: 'prod-2', sku: 'SKU-002', name: 'Product 2', currentStock: 50, bufferStock: 5 },
      ];

      const allMappings: ChannelMapping[] = [
        { productId: 'prod-1', channelId: 'ch-1', externalId: 'epos-123' },
        { productId: 'prod-2', channelId: 'ch-1', externalId: 'epos-456' },
      ];

      mockEposnowProvider.getStock
        .mockResolvedValueOnce(90)  // prod-1, expected 90
        .mockResolvedValueOnce(40); // prod-2, expected 45

      const report1 = await guardian.detectDrift(products[0], channels, allMappings);
      const report2 = await guardian.detectDrift(products[1], channels, allMappings);

      expect(report1.channelDrifts).toHaveLength(0);
      expect(report2.channelDrifts).toHaveLength(1);
    });
  });
});
