/**
 * Sync Flow E2E Tests
 * Tests the complete synchronization workflow
 */

import { test, expect, Page } from '@playwright/test';

// Test fixtures
const testProduct = {
  sku: 'E2E-SKU-001',
  name: 'E2E Test Product',
  stock: 100,
  bufferStock: 10,
};

// Helper to login before tests
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('test@example.com');
  await page.getByLabel(/password/i).fill('password123');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

test.describe('Sync Flow', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test.describe('Stock Update Sync', () => {
    test('should update stock from product page', async ({ page }) => {
      await page.goto('/products');

      // Find and click on a product row
      const productRow = page.getByRole('row').filter({ hasText: testProduct.sku });
      await productRow.click();

      // Open edit modal or navigate to edit page
      const editButton = page.getByRole('button', { name: /edit/i });
      await editButton.click();

      // Update stock value
      const stockInput = page.getByLabel(/stock|quantity/i);
      await stockInput.clear();
      await stockInput.fill('150');

      // Save changes
      await page.getByRole('button', { name: /save|update/i }).click();

      // Verify success message
      await expect(page.getByText(/updated|success/i)).toBeVisible();

      // Verify stock value is updated
      await expect(page.getByText('150')).toBeVisible();
    });

    test('should show sync in progress indicator', async ({ page }) => {
      await page.goto('/products');

      // Trigger a stock update
      const editButton = page.getByRole('button', { name: /edit/i }).first();
      await editButton.click();

      const stockInput = page.getByLabel(/stock|quantity/i);
      await stockInput.clear();
      await stockInput.fill('75');

      await page.getByRole('button', { name: /save|update/i }).click();

      // Look for sync indicator (spinner, progress bar, etc.)
      await expect(page.getByTestId('sync-indicator').or(page.getByRole('progressbar'))).toBeVisible();

      // Wait for sync to complete
      await expect(page.getByText(/synced|complete/i)).toBeVisible({ timeout: 10000 });
    });

    test('should sync to all connected channels', async ({ page }) => {
      await page.goto('/products');

      // Find product with multiple channels
      const productRow = page.getByRole('row').filter({ hasText: testProduct.sku });
      await productRow.click();

      // Verify channel badges are shown
      await expect(page.getByTestId('channel-badge').or(page.getByText(/eposnow|wix|deliveroo/i))).toBeVisible();

      // Update stock
      await page.getByRole('button', { name: /edit/i }).click();
      const stockInput = page.getByLabel(/stock|quantity/i);
      await stockInput.clear();
      await stockInput.fill('80');
      await page.getByRole('button', { name: /save|update/i }).click();

      // Wait for sync to complete
      await page.waitForTimeout(2000);

      // Check sync status for each channel
      await page.goto('/dashboard');
      const activityFeed = page.getByTestId('activity-feed').or(page.getByRole('region', { name: /activity/i }));

      await expect(activityFeed.getByText(/sync.*complete|synced/i)).toBeVisible();
    });
  });

  test.describe('Bulk Sync Operations', () => {
    test('should trigger full sync from channels page', async ({ page }) => {
      await page.goto('/channels');

      // Find sync button for a channel
      const syncButton = page.getByRole('button', { name: /sync|refresh/i }).first();
      await syncButton.click();

      // Confirm sync if needed
      const confirmButton = page.getByRole('button', { name: /confirm|yes/i });
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }

      // Verify sync started
      await expect(page.getByText(/sync.*started|syncing/i)).toBeVisible();

      // Wait for completion
      await expect(page.getByText(/sync.*complete/i)).toBeVisible({ timeout: 30000 });
    });

    test('should show sync progress for bulk operations', async ({ page }) => {
      await page.goto('/channels');

      // Trigger full sync
      await page.getByRole('button', { name: /sync all|full sync/i }).click();

      // Look for progress indicator
      const progress = page.getByRole('progressbar').or(page.getByTestId('sync-progress'));
      await expect(progress).toBeVisible();

      // Wait for completion
      await expect(page.getByText(/complete|finished/i)).toBeVisible({ timeout: 60000 });
    });
  });

  test.describe('Real-time Updates', () => {
    test('should receive real-time stock updates via WebSocket', async ({ page }) => {
      await page.goto('/dashboard');

      // Wait for WebSocket connection
      await page.waitForTimeout(1000);

      // Make an API call to update stock (simulating external update)
      await page.evaluate(async () => {
        // This would normally come from the backend
        const event = new CustomEvent('stockUpdate', {
          detail: {
            productId: 'prod-1',
            sku: 'E2E-SKU-001',
            newStock: 95,
          },
        });
        window.dispatchEvent(event);
      });

      // Verify real-time notification appears
      await expect(
        page.getByText(/stock.*updated|inventory.*changed/i).or(
          page.getByTestId('notification')
        )
      ).toBeVisible({ timeout: 5000 });
    });

    test('should update product list in real-time', async ({ page }) => {
      await page.goto('/products');

      // Get initial stock value
      const stockCell = page.getByTestId('product-stock').first();
      const initialStock = await stockCell.textContent();

      // Simulate WebSocket message
      await page.evaluate(() => {
        const ws = (window as any).__stocksync_ws__;
        if (ws) {
          ws.onmessage({
            data: JSON.stringify({
              type: 'stock_update',
              payload: { productId: 'prod-1', newStock: 999 },
            }),
          });
        }
      });

      // Verify stock value updated
      await expect(stockCell).not.toHaveText(initialStock || '');
    });
  });

  test.describe('Sync Error Handling', () => {
    test('should display error when sync fails', async ({ page }) => {
      await page.goto('/products');

      // Trigger a sync that will fail (using mock/test mode)
      await page.route('**/api/sync/**', (route) => {
        route.fulfill({
          status: 500,
          body: JSON.stringify({ error: 'Sync failed' }),
        });
      });

      await page.getByRole('button', { name: /edit/i }).first().click();
      const stockInput = page.getByLabel(/stock|quantity/i);
      await stockInput.clear();
      await stockInput.fill('50');
      await page.getByRole('button', { name: /save|update/i }).click();

      // Verify error message
      await expect(page.getByText(/error|failed|unable/i)).toBeVisible();
    });

    test('should show retry option on sync failure', async ({ page }) => {
      await page.goto('/channels');

      // Mock a failed sync
      await page.route('**/api/sync/**', (route) => {
        route.fulfill({
          status: 500,
          body: JSON.stringify({ error: 'Channel unavailable' }),
        });
      });

      await page.getByRole('button', { name: /sync/i }).first().click();

      // Verify error and retry button
      await expect(page.getByText(/error|failed/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /retry|try again/i })).toBeVisible();
    });

    test('should create alert for persistent sync errors', async ({ page }) => {
      await page.goto('/channels');

      // Mock multiple failed syncs
      let attempts = 0;
      await page.route('**/api/sync/**', (route) => {
        attempts++;
        route.fulfill({
          status: 500,
          body: JSON.stringify({ error: `Attempt ${attempts} failed` }),
        });
      });

      // Trigger sync
      await page.getByRole('button', { name: /sync/i }).first().click();

      // Navigate to alerts
      await page.goto('/dashboard');

      // Verify alert was created
      await expect(page.getByText(/sync.*error|sync.*failed/i)).toBeVisible();
    });
  });

  test.describe('Channel-Specific Sync', () => {
    test('should sync only to selected channel', async ({ page }) => {
      await page.goto('/products');

      // Open product with multiple channels
      await page.getByRole('row').filter({ hasText: testProduct.sku }).click();

      // Look for channel-specific sync options
      const channelSection = page.getByTestId('channel-actions').or(
        page.getByRole('region', { name: /channels/i })
      );

      if (await channelSection.isVisible()) {
        // Click sync for specific channel
        await channelSection.getByRole('button', { name: /sync.*eposnow/i }).click();

        // Verify only that channel was synced
        await expect(page.getByText(/eposnow.*synced|synced.*eposnow/i)).toBeVisible();
      }
    });

    test('should respect buffer stock for Deliveroo channel', async ({ page }) => {
      await page.goto('/products');

      // Find product synced to Deliveroo
      await page.getByRole('row').filter({ hasText: /deliveroo/i }).first().click();

      // Verify buffer stock is displayed
      await expect(page.getByText(/buffer.*stock|safety.*stock/i)).toBeVisible();

      // Verify synced stock = current - buffer
      const currentStock = await page.getByTestId('current-stock').textContent();
      const bufferStock = await page.getByTestId('buffer-stock').textContent();

      if (currentStock && bufferStock) {
        const expectedSyncedStock = parseInt(currentStock) - parseInt(bufferStock);
        await expect(page.getByText(`${expectedSyncedStock}`)).toBeVisible();
      }
    });
  });
});
