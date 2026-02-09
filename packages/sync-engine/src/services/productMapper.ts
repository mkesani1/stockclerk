/**
 * Product Mapper Service
 * Matches products between different channels using multiple strategies
 * Supports SKU, barcode, and fuzzy name matching
 */

import type { Product } from '@stockclerk/integrations';
import type {
  ProductMapping,
  MappingStrategy,
  MappingConfidence,
  ProductMapperOptions,
} from '../types.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_FUZZY_MATCH_THRESHOLD = 0.6;

// ============================================================================
// Product Mapper Service
// ============================================================================

export class ProductMapperService {
  private readonly fuzzyMatchThreshold: number;
  private readonly debug: boolean;
  private readonly manualMappingOverrides: Map<string, ProductMapping> = new Map();

  constructor(options?: ProductMapperOptions) {
    this.fuzzyMatchThreshold = options?.fuzzyMatchThreshold ?? DEFAULT_FUZZY_MATCH_THRESHOLD;
    this.debug = options?.debug ?? false;
  }

  /**
   * Map products between source and target channels
   * Returns array of ProductMapping with confidence scores
   */
  mapProducts(
    sourceProducts: Product[],
    targetProducts: Product[],
    sourceChannel: string,
    targetChannel: string
  ): ProductMapping[] {
    const mappings: ProductMapping[] = [];
    const targetProductMap = new Map<string, Product>();

    // Build lookup maps for faster access
    for (const product of targetProducts) {
      targetProductMap.set(product.id, product);
    }

    // Try to match each source product
    for (const sourceProduct of sourceProducts) {
      // Check for manual override first
      const overrideKey = this.getOverrideKey(sourceProduct.id, sourceChannel, targetChannel);
      const manualMapping = this.manualMappingOverrides.get(overrideKey);

      if (manualMapping) {
        mappings.push(manualMapping);
        this.log(
          `Using manual mapping for ${sourceProduct.sku}: ${sourceProduct.id} -> ${manualMapping.targetProductId}`
        );
        continue;
      }

      // Try matching strategies in order of priority
      const skuMatch = this.matchBySku(sourceProduct, targetProducts);
      if (skuMatch) {
        mappings.push({
          sourceProductId: sourceProduct.id,
          targetProductId: skuMatch.targetProduct.id,
          sourceChannel,
          targetChannel,
          matchStrategy: 'sku',
          confidence: skuMatch.confidence,
          mappedAt: new Date(),
        });
        this.log(`SKU match for ${sourceProduct.sku}: confidence ${skuMatch.confidence}`);
        continue;
      }

      // Try barcode matching
      const barcodeMatch = this.matchByBarcode(sourceProduct, targetProducts);
      if (barcodeMatch) {
        mappings.push({
          sourceProductId: sourceProduct.id,
          targetProductId: barcodeMatch.targetProduct.id,
          sourceChannel,
          targetChannel,
          matchStrategy: 'barcode',
          confidence: barcodeMatch.confidence,
          mappedAt: new Date(),
        });
        this.log(`Barcode match for ${sourceProduct.sku}: confidence ${barcodeMatch.confidence}`);
        continue;
      }

      // Try fuzzy name matching
      const nameMatch = this.matchByFuzzyName(sourceProduct, targetProducts);
      if (nameMatch && nameMatch.confidence >= this.fuzzyMatchThreshold) {
        mappings.push({
          sourceProductId: sourceProduct.id,
          targetProductId: nameMatch.targetProduct.id,
          sourceChannel,
          targetChannel,
          matchStrategy: 'name_fuzzy',
          confidence: nameMatch.confidence,
          mappedAt: new Date(),
        });
        this.log(`Fuzzy name match for ${sourceProduct.sku}: confidence ${nameMatch.confidence}`);
        continue;
      }

      this.log(`No match found for product ${sourceProduct.sku}`, 'warn');
    }

    return mappings;
  }

  /**
   * Add a manual mapping override
   * Manual mappings take priority over automatic strategies
   */
  addManualMapping(
    sourceProductId: string,
    targetProductId: string,
    sourceChannel: string,
    targetChannel: string
  ): void {
    const key = this.getOverrideKey(sourceProductId, sourceChannel, targetChannel);

    this.manualMappingOverrides.set(key, {
      sourceProductId,
      targetProductId,
      sourceChannel,
      targetChannel,
      matchStrategy: 'manual',
      confidence: 1.0,
      mappedAt: new Date(),
    });

    this.log(`Added manual mapping: ${sourceProductId} -> ${targetProductId}`);
  }

  /**
   * Remove a manual mapping override
   */
  removeManualMapping(
    sourceProductId: string,
    sourceChannel: string,
    targetChannel: string
  ): boolean {
    const key = this.getOverrideKey(sourceProductId, sourceChannel, targetChannel);
    return this.manualMappingOverrides.delete(key);
  }

  /**
   * Get all manual mapping overrides
   */
  getManualMappings(): ProductMapping[] {
    return Array.from(this.manualMappingOverrides.values());
  }

  /**
   * Clear all manual mapping overrides
   */
  clearManualMappings(): void {
    this.manualMappingOverrides.clear();
  }

  // ============================================================================
  // Matching Strategies
  // ============================================================================

  /**
   * Match products by exact SKU match
   */
  private matchBySku(
    sourceProduct: Product,
    targetProducts: Product[]
  ): { targetProduct: Product; confidence: number } | null {
    const sourceSku = sourceProduct.sku?.toLowerCase().trim();
    if (!sourceSku) {
      return null;
    }

    const match = targetProducts.find(
      (p) => p.sku?.toLowerCase().trim() === sourceSku
    );

    if (match) {
      return {
        targetProduct: match,
        confidence: 1.0,
      };
    }

    return null;
  }

  /**
   * Match products by barcode/UPC
   * Looks in product metadata for barcode field
   */
  private matchByBarcode(
    sourceProduct: Product,
    targetProducts: Product[]
  ): { targetProduct: Product; confidence: number } | null {
    const sourceBarcode = this.getBarcode(sourceProduct);
    if (!sourceBarcode) {
      return null;
    }

    const match = targetProducts.find((p) => {
      const targetBarcode = this.getBarcode(p);
      return targetBarcode === sourceBarcode;
    });

    if (match) {
      return {
        targetProduct: match,
        confidence: 0.95,
      };
    }

    return null;
  }

  /**
   * Match products by fuzzy name similarity
   * Uses Levenshtein distance for similarity calculation
   */
  private matchByFuzzyName(
    sourceProduct: Product,
    targetProducts: Product[]
  ): { targetProduct: Product; confidence: number } | null {
    const sourceName = sourceProduct.name?.toLowerCase().trim();
    if (!sourceName || sourceName.length === 0) {
      return null;
    }

    let bestMatch: {
      product: Product;
      similarity: number;
    } | null = null;

    for (const targetProduct of targetProducts) {
      const targetName = targetProduct.name?.toLowerCase().trim();
      if (!targetName) {
        continue;
      }

      const similarity = this.calculateStringSimilarity(sourceName, targetName);

      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = {
          product: targetProduct,
          similarity,
        };
      }
    }

    if (bestMatch && bestMatch.similarity >= this.fuzzyMatchThreshold) {
      return {
        targetProduct: bestMatch.product,
        confidence: bestMatch.similarity,
      };
    }

    return null;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Extract barcode from product metadata
   */
  private getBarcode(product: Product): string | null {
    if (!product.metadata) {
      return null;
    }

    // Look for common barcode field names
    const metadata = product.metadata as Record<string, unknown>;
    const barcode =
      metadata['barcode'] ||
      metadata['Barcode'] ||
      metadata['upc'] ||
      metadata['UPC'] ||
      metadata['ean'] ||
      metadata['EAN'];

    return typeof barcode === 'string' ? barcode : null;
  }

  /**
   * Calculate string similarity using Levenshtein distance
   * Returns a score between 0 and 1, where 1 is identical
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    const distance = this.levenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);

    if (maxLength === 0) {
      return 1.0; // Both strings are empty
    }

    return 1.0 - distance / maxLength;
  }

  /**
   * Calculate Levenshtein distance between two strings
   * This is the minimum number of single-character edits needed to change one string into another
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;

    // Create a 2D array for dynamic programming
    const dp: number[][] = Array(len1 + 1)
      .fill(null)
      .map(() => Array(len2 + 1).fill(0));

    // Initialize base cases
    for (let i = 0; i <= len1; i++) {
      dp[i][0] = i;
    }
    for (let j = 0; j <= len2; j++) {
      dp[0][j] = j;
    }

    // Fill the DP table
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;

        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, // deletion
          dp[i][j - 1] + 1, // insertion
          dp[i - 1][j - 1] + cost // substitution
        );
      }
    }

    return dp[len1][len2];
  }

  /**
   * Generate a unique key for manual mapping override
   */
  private getOverrideKey(
    sourceProductId: string,
    sourceChannel: string,
    targetChannel: string
  ): string {
    return `${sourceChannel}:${sourceProductId}:${targetChannel}`;
  }

  /**
   * Logging helper
   */
  private log(message: string, level: 'info' | 'warn' = 'info'): void {
    if (!this.debug) {
      return;
    }

    const prefix = '[ProductMapper]';
    const timestamp = new Date().toISOString();

    if (level === 'warn') {
      console.warn(`${timestamp} ${prefix} ${message}`);
    } else {
      console.log(`${timestamp} ${prefix} ${message}`);
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createProductMapper(options?: ProductMapperOptions): ProductMapperService {
  return new ProductMapperService(options);
}
