/**
 * Dashboard E2E Tests
 */

import { test, expect, Page } from '@playwright/test';

// Helper to login before tests
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('test@example.com');
  await page.getByLabel(/password/i).fill('password123');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test.describe('Layout and Navigation', () => {
    test('should display main dashboard layout', async ({ page }) => {
      await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
      await expect(page.getByRole('navigation')).toBeVisible();
    });

    test('should have working navigation menu', async ({ page }) => {
      // Dashboard link
      const dashboardLink = page.getByRole('link', { name: /dashboard/i });
      await expect(dashboardLink).toBeVisible();

      // Products link
      const productsLink = page.getByRole('link', { name: /products/i });
      await expect(productsLink).toBeVisible();
      await productsLink.click();
      await expect(page).toHaveURL(/\/products/);

      // Channels link
      await page.getByRole('link', { name: /channels/i }).click();
      await expect(page).toHaveURL(/\/channels/);

      // Settings link
      await page.getByRole('link', { name: /settings/i }).click();
      await expect(page).toHaveURL(/\/settings/);
    });

    test('should show user menu', async ({ page }) => {
      const userMenu = page.getByRole('button', { name: /user|account|profile/i });
      await expect(userMenu).toBeVisible();

      await userMenu.click();

      // Verify dropdown options
      await expect(page.getByText(/settings|account|logout/i)).toBeVisible();
    });
  });

  test.describe('Stats Cards', () => {
    test('should display all stat cards', async ({ page }) => {
      await expect(page.getByTestId('stat-total-products').or(
        page.getByText(/total products/i)
      )).toBeVisible();

      await expect(page.getByTestId('stat-low-stock').or(
        page.getByText(/low stock/i)
      )).toBeVisible();

      await expect(page.getByTestId('stat-active-channels').or(
        page.getByText(/active channels/i)
      )).toBeVisible();

      await expect(page.getByTestId('stat-synced-today').or(
        page.getByText(/synced today/i)
      )).toBeVisible();
    });

    test('should show numeric values in stat cards', async ({ page }) => {
      // Get all stat cards
      const statCards = page.getByTestId('stat-card').or(
        page.locator('[class*="stat"]')
      );

      // Each should have a numeric value
      const cards = await statCards.all();
      for (const card of cards) {
        const text = await card.textContent();
        expect(text).toMatch(/\d+/);
      }
    });

    test('should navigate to products when clicking products stat', async ({ page }) => {
      const productsStat = page.getByTestId('stat-total-products').or(
        page.getByText(/total products/i).locator('..')
      );

      await productsStat.click();
      await expect(page).toHaveURL(/\/products/);
    });

    test('should navigate to low stock products when clicking low stock stat', async ({ page }) => {
      const lowStockStat = page.getByTestId('stat-low-stock').or(
        page.getByText(/low stock/i).locator('..')
      );

      await lowStockStat.click();
      await expect(page).toHaveURL(/\/products.*low.*stock|filter=low/i);
    });
  });

  test.describe('Alerts Section', () => {
    test('should display alerts section', async ({ page }) => {
      await expect(page.getByRole('heading', { name: /alerts/i })).toBeVisible();
    });

    test('should show unread alerts count', async ({ page }) => {
      const alertsBadge = page.getByTestId('alerts-badge').or(
        page.locator('[class*="badge"]').filter({ hasText: /\d+/ })
      );

      // Badge should show a number
      if (await alertsBadge.isVisible()) {
        const badgeText = await alertsBadge.textContent();
        expect(badgeText).toMatch(/\d+/);
      }
    });

    test('should expand alert to show details', async ({ page }) => {
      const alertItem = page.getByTestId('alert-item').first();

      if (await alertItem.isVisible()) {
        await alertItem.click();

        // Should show expanded details
        await expect(page.getByText(/details|more info|product|channel/i)).toBeVisible();
      }
    });

    test('should mark alert as read', async ({ page }) => {
      const alertItem = page.getByTestId('alert-item').first();

      if (await alertItem.isVisible()) {
        const markReadButton = alertItem.getByRole('button', { name: /mark.*read|dismiss/i });

        if (await markReadButton.isVisible()) {
          await markReadButton.click();

          // Alert should no longer have unread indicator
          await expect(alertItem.getByTestId('unread-indicator')).not.toBeVisible();
        }
      }
    });

    test('should filter alerts by type', async ({ page }) => {
      const filterDropdown = page.getByRole('combobox', { name: /filter|type/i });

      if (await filterDropdown.isVisible()) {
        await filterDropdown.selectOption('low_stock');

        // Only low stock alerts should be visible
        const alerts = await page.getByTestId('alert-item').all();
        for (const alert of alerts) {
          await expect(alert).toContainText(/low stock|stock/i);
        }
      }
    });
  });

  test.describe('Channel Status Section', () => {
    test('should display channel status section', async ({ page }) => {
      await expect(page.getByRole('heading', { name: /channel|integration/i })).toBeVisible();
    });

    test('should show all connected channels', async ({ page }) => {
      const channelItems = page.getByTestId('channel-item');

      // Should have at least one channel
      await expect(channelItems.first()).toBeVisible();
    });

    test('should show connection status for each channel', async ({ page }) => {
      const channelItem = page.getByTestId('channel-item').first();

      // Should show status indicator
      await expect(channelItem.getByTestId('status-indicator').or(
        channelItem.getByText(/connected|active|offline|disconnected/i)
      )).toBeVisible();
    });

    test('should show last sync time', async ({ page }) => {
      const channelItem = page.getByTestId('channel-item').first();

      // Should show last sync info
      await expect(channelItem.getByText(/last sync|synced|ago|never/i)).toBeVisible();
    });

    test('should navigate to channel settings on click', async ({ page }) => {
      const channelItem = page.getByTestId('channel-item').first();
      await channelItem.click();

      await expect(page).toHaveURL(/\/channels/);
    });
  });

  test.describe('Recent Activity Section', () => {
    test('should display recent activity section', async ({ page }) => {
      await expect(page.getByRole('heading', { name: /activity|recent/i })).toBeVisible();
    });

    test('should show activity items with timestamps', async ({ page }) => {
      const activityItems = page.getByTestId('activity-item');

      if (await activityItems.first().isVisible()) {
        const firstItem = activityItems.first();

        // Should have timestamp
        await expect(firstItem.getByText(/ago|just now|today|yesterday/i)).toBeVisible();
      }
    });

    test('should show activity icons or badges', async ({ page }) => {
      const activityItem = page.getByTestId('activity-item').first();

      if (await activityItem.isVisible()) {
        // Should have an icon or type badge
        await expect(activityItem.locator('svg').or(
          activityItem.getByTestId('activity-icon')
        )).toBeVisible();
      }
    });

    test('should load more activities on scroll or click', async ({ page }) => {
      const loadMoreButton = page.getByRole('button', { name: /load more|show more/i });

      if (await loadMoreButton.isVisible()) {
        const initialCount = await page.getByTestId('activity-item').count();

        await loadMoreButton.click();

        await expect(page.getByTestId('activity-item')).toHaveCount(initialCount + 10);
      }
    });
  });

  test.describe('Quick Actions', () => {
    test('should have add product quick action', async ({ page }) => {
      const addProductButton = page.getByRole('button', { name: /add product/i });

      if (await addProductButton.isVisible()) {
        await addProductButton.click();
        await expect(page.getByRole('dialog').or(page)).toHaveURL(/\/products.*add|new/);
      }
    });

    test('should have sync now quick action', async ({ page }) => {
      const syncButton = page.getByRole('button', { name: /sync now|sync all/i });

      if (await syncButton.isVisible()) {
        await syncButton.click();

        // Should show sync confirmation or start sync
        await expect(
          page.getByText(/syncing|sync started|confirm/i)
        ).toBeVisible();
      }
    });

    test('should have connect channel quick action', async ({ page }) => {
      const connectButton = page.getByRole('button', { name: /connect.*channel|add.*channel/i });

      if (await connectButton.isVisible()) {
        await connectButton.click();
        await expect(page).toHaveURL(/\/channels.*add|connect|new/);
      }
    });
  });

  test.describe('Responsive Design', () => {
    test('should adapt to mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.reload();

      // Navigation should be collapsed into hamburger menu
      await expect(page.getByRole('button', { name: /menu/i })).toBeVisible();

      // Stats should stack vertically
      const statsSection = page.getByTestId('stats-section');
      if (await statsSection.isVisible()) {
        const box = await statsSection.boundingBox();
        expect(box?.width).toBeLessThan(400);
      }
    });

    test('should show mobile navigation menu', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.reload();

      await page.getByRole('button', { name: /menu/i }).click();

      // Mobile nav should be visible
      await expect(page.getByRole('navigation')).toBeVisible();
      await expect(page.getByRole('link', { name: /products/i })).toBeVisible();
    });
  });

  test.describe('Data Refresh', () => {
    test('should have refresh button', async ({ page }) => {
      const refreshButton = page.getByRole('button', { name: /refresh/i });

      if (await refreshButton.isVisible()) {
        await refreshButton.click();

        // Should show loading state briefly
        await expect(
          page.getByRole('progressbar').or(page.getByTestId('loading'))
        ).toBeVisible();
      }
    });

    test('should auto-refresh data', async ({ page }) => {
      // Wait for auto-refresh (usually every 30 seconds)
      await page.waitForResponse(
        (response) => response.url().includes('/api/dashboard'),
        { timeout: 35000 }
      );

      // Data should still be visible after refresh
      await expect(page.getByTestId('stat-total-products')).toBeVisible();
    });
  });
});
