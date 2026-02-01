/**
 * Alert Service Tests
 * Tests alert rule evaluation and notification logic
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

interface AlertRule {
  id: string;
  tenantId: string;
  name: string;
  type: 'low_stock' | 'sync_error' | 'channel_disconnected' | 'drift_detected';
  conditions: {
    threshold?: number;
    percentageThreshold?: number;
    channels?: string[];
    products?: string[];
  };
  actions: {
    notify: boolean;
    email?: string[];
    webhook?: string;
    autoRepair?: boolean;
  };
  isActive: boolean;
}

interface Alert {
  id: string;
  tenantId: string;
  ruleId?: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  metadata: Record<string, unknown>;
  isRead: boolean;
  createdAt: Date;
}

interface AlertEvaluation {
  ruleId: string;
  triggered: boolean;
  alert?: Omit<Alert, 'id' | 'createdAt'>;
}

// Mock notification service
const mockNotificationService = {
  sendEmail: vi.fn(),
  sendWebhook: vi.fn(),
  broadcastWebSocket: vi.fn(),
};

// AlertService class for testing
class AlertService {
  private rules: AlertRule[] = [];
  private alerts: Alert[] = [];
  private notificationService = mockNotificationService;

  constructor(rules: AlertRule[] = []) {
    this.rules = rules;
  }

  evaluateLowStockRule(rule: AlertRule, product: Product): AlertEvaluation {
    if (!rule.isActive || rule.type !== 'low_stock') {
      return { ruleId: rule.id, triggered: false };
    }

    // Check if rule applies to this product
    if (rule.conditions.products && !rule.conditions.products.includes(product.id)) {
      return { ruleId: rule.id, triggered: false };
    }

    const threshold = rule.conditions.threshold ?? product.bufferStock;
    const triggered = product.currentStock <= threshold;

    if (!triggered) {
      return { ruleId: rule.id, triggered: false };
    }

    const severity = product.currentStock === 0 ? 'critical' :
                     product.currentStock <= threshold / 2 ? 'warning' : 'info';

    return {
      ruleId: rule.id,
      triggered: true,
      alert: {
        tenantId: rule.tenantId,
        ruleId: rule.id,
        type: 'low_stock',
        severity,
        message: `Low stock alert: ${product.name} (${product.sku}) has ${product.currentStock} units remaining`,
        metadata: {
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          currentStock: product.currentStock,
          threshold,
          bufferStock: product.bufferStock,
        },
        isRead: false,
      },
    };
  }

  evaluateSyncErrorRule(
    rule: AlertRule,
    error: { channelId: string; channelName: string; message: string; productId?: string }
  ): AlertEvaluation {
    if (!rule.isActive || rule.type !== 'sync_error') {
      return { ruleId: rule.id, triggered: false };
    }

    // Check if rule applies to this channel
    if (rule.conditions.channels && !rule.conditions.channels.includes(error.channelId)) {
      return { ruleId: rule.id, triggered: false };
    }

    return {
      ruleId: rule.id,
      triggered: true,
      alert: {
        tenantId: rule.tenantId,
        ruleId: rule.id,
        type: 'sync_error',
        severity: 'warning',
        message: `Sync error on ${error.channelName}: ${error.message}`,
        metadata: {
          channelId: error.channelId,
          channelName: error.channelName,
          errorMessage: error.message,
          productId: error.productId,
        },
        isRead: false,
      },
    };
  }

  evaluateDriftRule(
    rule: AlertRule,
    drift: { productId: string; productName: string; channelId: string; channelName: string; driftPercentage: number }
  ): AlertEvaluation {
    if (!rule.isActive || rule.type !== 'drift_detected') {
      return { ruleId: rule.id, triggered: false };
    }

    const percentageThreshold = rule.conditions.percentageThreshold ?? 10;
    const triggered = drift.driftPercentage >= percentageThreshold;

    if (!triggered) {
      return { ruleId: rule.id, triggered: false };
    }

    const severity = drift.driftPercentage >= 50 ? 'critical' :
                     drift.driftPercentage >= 25 ? 'warning' : 'info';

    return {
      ruleId: rule.id,
      triggered: true,
      alert: {
        tenantId: rule.tenantId,
        ruleId: rule.id,
        type: 'drift_detected',
        severity,
        message: `Stock drift detected for ${drift.productName} on ${drift.channelName}: ${drift.driftPercentage.toFixed(1)}% difference`,
        metadata: {
          productId: drift.productId,
          productName: drift.productName,
          channelId: drift.channelId,
          channelName: drift.channelName,
          driftPercentage: drift.driftPercentage,
          autoRepair: rule.actions.autoRepair ?? false,
        },
        isRead: false,
      },
    };
  }

  async processAlert(evaluation: AlertEvaluation, rule: AlertRule): Promise<Alert | null> {
    if (!evaluation.triggered || !evaluation.alert) {
      return null;
    }

    const alert: Alert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...evaluation.alert,
      createdAt: new Date(),
    };

    this.alerts.push(alert);

    // Execute actions
    if (rule.actions.notify) {
      this.notificationService.broadcastWebSocket(alert);
    }

    if (rule.actions.email?.length) {
      await this.notificationService.sendEmail(rule.actions.email, alert);
    }

    if (rule.actions.webhook) {
      await this.notificationService.sendWebhook(rule.actions.webhook, alert);
    }

    return alert;
  }

  async evaluateAllRules(
    context: { type: 'low_stock'; product: Product } |
             { type: 'sync_error'; error: { channelId: string; channelName: string; message: string; productId?: string } } |
             { type: 'drift_detected'; drift: { productId: string; productName: string; channelId: string; channelName: string; driftPercentage: number } }
  ): Promise<Alert[]> {
    const triggeredAlerts: Alert[] = [];

    for (const rule of this.rules) {
      let evaluation: AlertEvaluation;

      switch (context.type) {
        case 'low_stock':
          if (rule.type !== 'low_stock') continue;
          evaluation = this.evaluateLowStockRule(rule, context.product);
          break;
        case 'sync_error':
          if (rule.type !== 'sync_error') continue;
          evaluation = this.evaluateSyncErrorRule(rule, context.error);
          break;
        case 'drift_detected':
          if (rule.type !== 'drift_detected') continue;
          evaluation = this.evaluateDriftRule(rule, context.drift);
          break;
      }

      const alert = await this.processAlert(evaluation, rule);
      if (alert) {
        triggeredAlerts.push(alert);
      }
    }

    return triggeredAlerts;
  }

  getUnreadAlerts(tenantId: string): Alert[] {
    return this.alerts.filter((a) => a.tenantId === tenantId && !a.isRead);
  }

  markAsRead(alertId: string): boolean {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.isRead = true;
      return true;
    }
    return false;
  }
}

describe('AlertService', () => {
  let alertService: AlertService;

  const tenantId = 'tenant-123';

  const lowStockRule: AlertRule = {
    id: 'rule-low-stock',
    tenantId,
    name: 'Low Stock Alert',
    type: 'low_stock',
    conditions: {
      threshold: 10,
    },
    actions: {
      notify: true,
      email: ['manager@example.com'],
    },
    isActive: true,
  };

  const syncErrorRule: AlertRule = {
    id: 'rule-sync-error',
    tenantId,
    name: 'Sync Error Alert',
    type: 'sync_error',
    conditions: {},
    actions: {
      notify: true,
      webhook: 'https://slack.webhook.example.com',
    },
    isActive: true,
  };

  const driftRule: AlertRule = {
    id: 'rule-drift',
    tenantId,
    name: 'Drift Detection Alert',
    type: 'drift_detected',
    conditions: {
      percentageThreshold: 15,
    },
    actions: {
      notify: true,
      autoRepair: true,
    },
    isActive: true,
  };

  beforeEach(() => {
    alertService = new AlertService([lowStockRule, syncErrorRule, driftRule]);
    vi.clearAllMocks();
    mockNotificationService.sendEmail.mockResolvedValue({ success: true });
    mockNotificationService.sendWebhook.mockResolvedValue({ success: true });
  });

  describe('Low Stock Rule Evaluation', () => {
    it('should trigger alert when stock is below threshold', () => {
      const product: Product = {
        id: 'prod-1',
        sku: 'SKU-001',
        name: 'Test Product',
        currentStock: 5,
        bufferStock: 10,
      };

      const evaluation = alertService.evaluateLowStockRule(lowStockRule, product);

      expect(evaluation.triggered).toBe(true);
      expect(evaluation.alert?.type).toBe('low_stock');
      expect(evaluation.alert?.severity).toBe('warning');
    });

    it('should set critical severity when stock is zero', () => {
      const product: Product = {
        id: 'prod-1',
        sku: 'SKU-001',
        name: 'Test Product',
        currentStock: 0,
        bufferStock: 10,
      };

      const evaluation = alertService.evaluateLowStockRule(lowStockRule, product);

      expect(evaluation.triggered).toBe(true);
      expect(evaluation.alert?.severity).toBe('critical');
    });

    it('should not trigger when stock is above threshold', () => {
      const product: Product = {
        id: 'prod-1',
        sku: 'SKU-001',
        name: 'Test Product',
        currentStock: 50,
        bufferStock: 10,
      };

      const evaluation = alertService.evaluateLowStockRule(lowStockRule, product);

      expect(evaluation.triggered).toBe(false);
    });

    it('should not trigger for inactive rules', () => {
      const inactiveRule = { ...lowStockRule, isActive: false };
      alertService = new AlertService([inactiveRule]);

      const product: Product = {
        id: 'prod-1',
        sku: 'SKU-001',
        name: 'Test Product',
        currentStock: 5,
        bufferStock: 10,
      };

      const evaluation = alertService.evaluateLowStockRule(inactiveRule, product);

      expect(evaluation.triggered).toBe(false);
    });

    it('should respect product filter in conditions', () => {
      const filteredRule = {
        ...lowStockRule,
        conditions: {
          ...lowStockRule.conditions,
          products: ['prod-other'],
        },
      };

      const product: Product = {
        id: 'prod-1',
        sku: 'SKU-001',
        name: 'Test Product',
        currentStock: 5,
        bufferStock: 10,
      };

      const evaluation = alertService.evaluateLowStockRule(filteredRule, product);

      expect(evaluation.triggered).toBe(false);
    });

    it('should use buffer stock as default threshold', () => {
      const ruleWithoutThreshold = {
        ...lowStockRule,
        conditions: {},
      };

      const product: Product = {
        id: 'prod-1',
        sku: 'SKU-001',
        name: 'Test Product',
        currentStock: 10, // Equal to buffer
        bufferStock: 10,
      };

      const evaluation = alertService.evaluateLowStockRule(ruleWithoutThreshold, product);

      expect(evaluation.triggered).toBe(true);
    });
  });

  describe('Sync Error Rule Evaluation', () => {
    it('should trigger alert on sync error', () => {
      const error = {
        channelId: 'ch-1',
        channelName: 'Test POS',
        message: 'API rate limit exceeded',
        productId: 'prod-1',
      };

      const evaluation = alertService.evaluateSyncErrorRule(syncErrorRule, error);

      expect(evaluation.triggered).toBe(true);
      expect(evaluation.alert?.type).toBe('sync_error');
      expect(evaluation.alert?.severity).toBe('warning');
    });

    it('should respect channel filter', () => {
      const filteredRule = {
        ...syncErrorRule,
        conditions: {
          channels: ['ch-other'],
        },
      };

      const error = {
        channelId: 'ch-1',
        channelName: 'Test POS',
        message: 'API error',
      };

      const evaluation = alertService.evaluateSyncErrorRule(filteredRule, error);

      expect(evaluation.triggered).toBe(false);
    });
  });

  describe('Drift Detection Rule Evaluation', () => {
    it('should trigger alert when drift exceeds percentage threshold', () => {
      const drift = {
        productId: 'prod-1',
        productName: 'Test Product',
        channelId: 'ch-1',
        channelName: 'Test POS',
        driftPercentage: 25,
      };

      const evaluation = alertService.evaluateDriftRule(driftRule, drift);

      expect(evaluation.triggered).toBe(true);
      expect(evaluation.alert?.type).toBe('drift_detected');
      expect(evaluation.alert?.severity).toBe('warning');
    });

    it('should set critical severity for large drift', () => {
      const drift = {
        productId: 'prod-1',
        productName: 'Test Product',
        channelId: 'ch-1',
        channelName: 'Test POS',
        driftPercentage: 55,
      };

      const evaluation = alertService.evaluateDriftRule(driftRule, drift);

      expect(evaluation.alert?.severity).toBe('critical');
    });

    it('should not trigger when drift is below threshold', () => {
      const drift = {
        productId: 'prod-1',
        productName: 'Test Product',
        channelId: 'ch-1',
        channelName: 'Test POS',
        driftPercentage: 10,
      };

      const evaluation = alertService.evaluateDriftRule(driftRule, drift);

      expect(evaluation.triggered).toBe(false);
    });

    it('should include autoRepair flag in metadata', () => {
      const drift = {
        productId: 'prod-1',
        productName: 'Test Product',
        channelId: 'ch-1',
        channelName: 'Test POS',
        driftPercentage: 25,
      };

      const evaluation = alertService.evaluateDriftRule(driftRule, drift);

      expect((evaluation.alert?.metadata as any).autoRepair).toBe(true);
    });
  });

  describe('Alert Processing', () => {
    it('should send WebSocket notification when notify is true', async () => {
      const evaluation: AlertEvaluation = {
        ruleId: lowStockRule.id,
        triggered: true,
        alert: {
          tenantId,
          ruleId: lowStockRule.id,
          type: 'low_stock',
          severity: 'warning',
          message: 'Test alert',
          metadata: {},
          isRead: false,
        },
      };

      await alertService.processAlert(evaluation, lowStockRule);

      expect(mockNotificationService.broadcastWebSocket).toHaveBeenCalled();
    });

    it('should send email when configured', async () => {
      const evaluation: AlertEvaluation = {
        ruleId: lowStockRule.id,
        triggered: true,
        alert: {
          tenantId,
          ruleId: lowStockRule.id,
          type: 'low_stock',
          severity: 'warning',
          message: 'Test alert',
          metadata: {},
          isRead: false,
        },
      };

      await alertService.processAlert(evaluation, lowStockRule);

      expect(mockNotificationService.sendEmail).toHaveBeenCalledWith(
        ['manager@example.com'],
        expect.objectContaining({ type: 'low_stock' })
      );
    });

    it('should send webhook when configured', async () => {
      const evaluation: AlertEvaluation = {
        ruleId: syncErrorRule.id,
        triggered: true,
        alert: {
          tenantId,
          ruleId: syncErrorRule.id,
          type: 'sync_error',
          severity: 'warning',
          message: 'Test error',
          metadata: {},
          isRead: false,
        },
      };

      await alertService.processAlert(evaluation, syncErrorRule);

      expect(mockNotificationService.sendWebhook).toHaveBeenCalledWith(
        'https://slack.webhook.example.com',
        expect.objectContaining({ type: 'sync_error' })
      );
    });

    it('should not process non-triggered evaluations', async () => {
      const evaluation: AlertEvaluation = {
        ruleId: lowStockRule.id,
        triggered: false,
      };

      const result = await alertService.processAlert(evaluation, lowStockRule);

      expect(result).toBeNull();
      expect(mockNotificationService.broadcastWebSocket).not.toHaveBeenCalled();
    });
  });

  describe('Evaluate All Rules', () => {
    it('should evaluate all matching rules for low stock', async () => {
      const product: Product = {
        id: 'prod-1',
        sku: 'SKU-001',
        name: 'Test Product',
        currentStock: 5,
        bufferStock: 10,
      };

      const alerts = await alertService.evaluateAllRules({
        type: 'low_stock',
        product,
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('low_stock');
    });

    it('should handle multiple triggered rules', async () => {
      const additionalLowStockRule: AlertRule = {
        id: 'rule-low-stock-2',
        tenantId,
        name: 'Critical Stock Alert',
        type: 'low_stock',
        conditions: {
          threshold: 5,
        },
        actions: {
          notify: true,
        },
        isActive: true,
      };

      alertService = new AlertService([lowStockRule, additionalLowStockRule]);

      const product: Product = {
        id: 'prod-1',
        sku: 'SKU-001',
        name: 'Test Product',
        currentStock: 3, // Triggers both rules
        bufferStock: 10,
      };

      const alerts = await alertService.evaluateAllRules({
        type: 'low_stock',
        product,
      });

      expect(alerts).toHaveLength(2);
    });
  });

  describe('Alert Management', () => {
    it('should track unread alerts', async () => {
      const product: Product = {
        id: 'prod-1',
        sku: 'SKU-001',
        name: 'Test Product',
        currentStock: 5,
        bufferStock: 10,
      };

      await alertService.evaluateAllRules({ type: 'low_stock', product });

      const unread = alertService.getUnreadAlerts(tenantId);

      expect(unread).toHaveLength(1);
    });

    it('should mark alerts as read', async () => {
      const product: Product = {
        id: 'prod-1',
        sku: 'SKU-001',
        name: 'Test Product',
        currentStock: 5,
        bufferStock: 10,
      };

      const [alert] = await alertService.evaluateAllRules({ type: 'low_stock', product });
      expect(alertService.getUnreadAlerts(tenantId)).toHaveLength(1);

      alertService.markAsRead(alert.id);

      expect(alertService.getUnreadAlerts(tenantId)).toHaveLength(0);
    });

    it('should return false when marking non-existent alert as read', () => {
      const result = alertService.markAsRead('non-existent-id');

      expect(result).toBe(false);
    });
  });
});
