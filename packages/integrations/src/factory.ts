/**
 * Provider Factory
 * Creates inventory providers based on channel type
 */

import type { InventoryProvider, ChannelType, ChannelCredentials } from './unified.js';
import { EposnowProvider } from './providers/eposnow-provider.js';
import { WixProvider } from './providers/wix-provider.js';
import { OtterProvider } from './providers/otter-provider.js';

// ============================================================================
// Factory Types
// ============================================================================

export interface ProviderFactoryOptions {
  /** Whether to automatically connect on creation */
  autoConnect?: boolean;
  /** Webhook secret for signature validation */
  webhookSecret?: string;
}

// ============================================================================
// Provider Factory
// ============================================================================

/**
 * Create an inventory provider for the specified channel type
 */
export function createProvider(
  type: ChannelType,
  options?: ProviderFactoryOptions
): InventoryProvider {
  let provider: InventoryProvider;

  switch (type) {
    case 'eposnow':
      provider = new EposnowProvider();
      if (options?.webhookSecret) {
        (provider as EposnowProvider).setWebhookSecret(options.webhookSecret);
      }
      break;

    case 'wix':
      provider = new WixProvider();
      if (options?.webhookSecret) {
        (provider as WixProvider).setWebhookSecret(options.webhookSecret);
      }
      break;

    case 'deliveroo':
      provider = new OtterProvider();
      if (options?.webhookSecret) {
        (provider as OtterProvider).setWebhookSecret(options.webhookSecret);
      }
      break;

    default:
      throw new UnknownProviderError(type as string);
  }

  return provider;
}

/**
 * Create and connect an inventory provider
 */
export async function createConnectedProvider(
  type: ChannelType,
  credentials: ChannelCredentials,
  options?: ProviderFactoryOptions
): Promise<InventoryProvider> {
  const provider = createProvider(type, options);
  await provider.connect(credentials);
  return provider;
}

// ============================================================================
// Provider Registry
// ============================================================================

/**
 * Registry for managing multiple providers
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, InventoryProvider>();

  /**
   * Register a provider with a unique key
   */
  register(key: string, provider: InventoryProvider): void {
    if (this.providers.has(key)) {
      throw new Error(`Provider with key "${key}" already registered`);
    }
    this.providers.set(key, provider);
  }

  /**
   * Get a provider by key
   */
  get(key: string): InventoryProvider | undefined {
    return this.providers.get(key);
  }

  /**
   * Check if a provider is registered
   */
  has(key: string): boolean {
    return this.providers.has(key);
  }

  /**
   * Remove a provider
   */
  async remove(key: string): Promise<boolean> {
    const provider = this.providers.get(key);
    if (provider) {
      await provider.disconnect();
      this.providers.delete(key);
      return true;
    }
    return false;
  }

  /**
   * Get all providers
   */
  getAll(): Map<string, InventoryProvider> {
    return new Map(this.providers);
  }

  /**
   * Get all providers of a specific type
   */
  getByType(type: ChannelType): InventoryProvider[] {
    return Array.from(this.providers.values()).filter(
      (provider) => provider.channelType === type
    );
  }

  /**
   * Disconnect all providers
   */
  async disconnectAll(): Promise<void> {
    await Promise.all(
      Array.from(this.providers.values()).map((provider) => provider.disconnect())
    );
  }

  /**
   * Clear all providers (disconnecting first)
   */
  async clear(): Promise<void> {
    await this.disconnectAll();
    this.providers.clear();
  }

  /**
   * Get count of registered providers
   */
  get size(): number {
    return this.providers.size;
  }
}

/**
 * Create a new provider registry
 */
export function createProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry();
}

// ============================================================================
// Provider Manager
// ============================================================================

/**
 * Manager for handling provider lifecycle and operations
 */
export class ProviderManager {
  private readonly registry = new ProviderRegistry();

  /**
   * Add a new provider
   */
  async addProvider(
    key: string,
    type: ChannelType,
    credentials: ChannelCredentials,
    options?: ProviderFactoryOptions
  ): Promise<InventoryProvider> {
    const provider = await createConnectedProvider(type, credentials, options);
    this.registry.register(key, provider);
    return provider;
  }

  /**
   * Get a provider by key
   */
  getProvider(key: string): InventoryProvider | undefined {
    return this.registry.get(key);
  }

  /**
   * Remove a provider
   */
  async removeProvider(key: string): Promise<boolean> {
    return this.registry.remove(key);
  }

  /**
   * Health check all providers
   */
  async healthCheckAll(): Promise<Map<string, { connected: boolean; error?: string }>> {
    const results = new Map<string, { connected: boolean; error?: string }>();

    await Promise.all(
      Array.from(this.registry.getAll().entries()).map(async ([key, provider]) => {
        const health = await provider.healthCheck();
        results.set(key, {
          connected: health.connected,
          error: health.error,
        });
      })
    );

    return results;
  }

  /**
   * Get all products from all providers
   */
  async getAllProducts(): Promise<Map<string, Awaited<ReturnType<InventoryProvider['getProducts']>>>> {
    const results = new Map<string, Awaited<ReturnType<InventoryProvider['getProducts']>>>();

    await Promise.all(
      Array.from(this.registry.getAll().entries()).map(async ([key, provider]) => {
        if (provider.isConnected()) {
          const products = await provider.getProducts();
          results.set(key, products);
        }
      })
    );

    return results;
  }

  /**
   * Broadcast stock update to all connected providers
   */
  async broadcastStockUpdate(
    externalIds: Map<string, string>, // key -> externalId
    quantity: number
  ): Promise<Map<string, { success: boolean; error?: string }>> {
    const results = new Map<string, { success: boolean; error?: string }>();

    await Promise.all(
      Array.from(externalIds.entries()).map(async ([key, externalId]) => {
        const provider = this.registry.get(key);
        if (!provider || !provider.isConnected()) {
          results.set(key, { success: false, error: 'Provider not found or not connected' });
          return;
        }

        try {
          await provider.updateStock(externalId, quantity);
          results.set(key, { success: true });
        } catch (error) {
          results.set(key, {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      })
    );

    return results;
  }

  /**
   * Shutdown all providers
   */
  async shutdown(): Promise<void> {
    await this.registry.clear();
  }

  /**
   * Get the underlying registry
   */
  getRegistry(): ProviderRegistry {
    return this.registry;
  }
}

/**
 * Create a new provider manager
 */
export function createProviderManager(): ProviderManager {
  return new ProviderManager();
}

// ============================================================================
// Error Classes
// ============================================================================

export class UnknownProviderError extends Error {
  constructor(type: string) {
    super(`Unknown provider type: ${type}`);
    this.name = 'UnknownProviderError';
  }
}
