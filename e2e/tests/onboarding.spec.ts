/**
 * Onboarding Flow E2E Tests
 */

import { test, expect, Page } from '@playwright/test';

test.describe('Onboarding Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Start fresh - clear any existing auth state
    await page.goto('/');
  });

  test.describe('Registration', () => {
    test('should display registration form', async ({ page }) => {
      await page.goto('/register');

      await expect(page.getByRole('heading', { name: /create.*account/i })).toBeVisible();
      await expect(page.getByLabel(/company name/i)).toBeVisible();
      await expect(page.getByLabel(/email/i)).toBeVisible();
      await expect(page.getByLabel(/password/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /register|sign up|create/i })).toBeVisible();
    });

    test('should validate required fields', async ({ page }) => {
      await page.goto('/register');

      // Try to submit empty form
      await page.getByRole('button', { name: /register|sign up|create/i }).click();

      // Should show validation errors
      await expect(page.getByText(/required|please enter/i)).toBeVisible();
    });

    test('should validate email format', async ({ page }) => {
      await page.goto('/register');

      await page.getByLabel(/email/i).fill('invalid-email');
      await page.getByRole('button', { name: /register|sign up|create/i }).click();

      await expect(page.getByText(/valid email|invalid email/i)).toBeVisible();
    });

    test('should validate password requirements', async ({ page }) => {
      await page.goto('/register');

      await page.getByLabel(/password/i).fill('short');
      await page.getByRole('button', { name: /register|sign up|create/i }).click();

      await expect(page.getByText(/at least 8|minimum 8|too short/i)).toBeVisible();
    });

    test('should successfully register new user', async ({ page }) => {
      await page.goto('/register');

      const uniqueEmail = `test-${Date.now()}@example.com`;

      await page.getByLabel(/company name/i).fill('Test Company');
      await page.getByLabel(/email/i).fill(uniqueEmail);
      await page.getByLabel(/password/i).fill('SecurePassword123!');

      await page.getByRole('button', { name: /register|sign up|create/i }).click();

      // Should redirect to onboarding or dashboard
      await expect(page).toHaveURL(/\/(onboarding|dashboard)/);
    });

    test('should show error for duplicate email', async ({ page }) => {
      await page.goto('/register');

      // Use an email that would already exist
      await page.getByLabel(/company name/i).fill('Test Company');
      await page.getByLabel(/email/i).fill('existing@example.com');
      await page.getByLabel(/password/i).fill('SecurePassword123!');

      await page.getByRole('button', { name: /register|sign up|create/i }).click();

      // Should show error message
      await expect(page.getByText(/already exists|already registered/i)).toBeVisible();
    });
  });

  test.describe('Login', () => {
    test('should display login form', async ({ page }) => {
      await page.goto('/login');

      await expect(page.getByRole('heading', { name: /sign in|log in/i })).toBeVisible();
      await expect(page.getByLabel(/email/i)).toBeVisible();
      await expect(page.getByLabel(/password/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /sign in|log in/i })).toBeVisible();
    });

    test('should validate required fields', async ({ page }) => {
      await page.goto('/login');

      await page.getByRole('button', { name: /sign in|log in/i }).click();

      await expect(page.getByText(/required|please enter/i)).toBeVisible();
    });

    test('should show error for invalid credentials', async ({ page }) => {
      await page.goto('/login');

      await page.getByLabel(/email/i).fill('wrong@example.com');
      await page.getByLabel(/password/i).fill('wrongpassword');

      await page.getByRole('button', { name: /sign in|log in/i }).click();

      await expect(page.getByText(/invalid|incorrect|wrong/i)).toBeVisible();
    });

    test('should successfully login with valid credentials', async ({ page }) => {
      await page.goto('/login');

      // Use test credentials
      await page.getByLabel(/email/i).fill('test@example.com');
      await page.getByLabel(/password/i).fill('password123');

      await page.getByRole('button', { name: /sign in|log in/i }).click();

      // Should redirect to dashboard
      await expect(page).toHaveURL(/\/dashboard/);
    });

    test('should have link to registration', async ({ page }) => {
      await page.goto('/login');

      const registerLink = page.getByRole('link', { name: /register|sign up|create account/i });
      await expect(registerLink).toBeVisible();

      await registerLink.click();
      await expect(page).toHaveURL(/\/register/);
    });
  });

  test.describe('Onboarding Steps', () => {
    test.beforeEach(async ({ page }) => {
      // Login first
      await page.goto('/login');
      await page.getByLabel(/email/i).fill('newuser@example.com');
      await page.getByLabel(/password/i).fill('password123');
      await page.getByRole('button', { name: /sign in|log in/i }).click();
      await page.waitForURL(/\/(onboarding|dashboard)/);
    });

    test('should display onboarding welcome step', async ({ page }) => {
      await page.goto('/onboarding');

      await expect(page.getByText(/welcome|get started|setup/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /next|continue|start/i })).toBeVisible();
    });

    test('should navigate through onboarding steps', async ({ page }) => {
      await page.goto('/onboarding');

      // Step 1: Welcome
      await page.getByRole('button', { name: /next|continue|start/i }).click();

      // Step 2: Connect Channel
      await expect(page.getByText(/connect.*channel|add.*integration/i)).toBeVisible();
      await page.getByRole('button', { name: /next|continue|skip/i }).click();

      // Step 3: Add Products (or similar)
      await expect(page.getByText(/product|inventory/i)).toBeVisible();
    });

    test('should allow skipping optional steps', async ({ page }) => {
      await page.goto('/onboarding');

      // Look for skip buttons
      const skipButton = page.getByRole('button', { name: /skip/i });

      if (await skipButton.isVisible()) {
        await skipButton.click();
        // Should advance to next step or complete
        await expect(page).not.toHaveURL(/\/onboarding\/1/);
      }
    });

    test('should complete onboarding and redirect to dashboard', async ({ page }) => {
      await page.goto('/onboarding');

      // Complete all steps
      const nextButtons = page.getByRole('button', { name: /next|continue|complete|finish/i });

      // Click through steps
      while (await nextButtons.first().isVisible()) {
        await nextButtons.first().click();
        await page.waitForTimeout(500); // Wait for transition
      }

      // Should be on dashboard after completion
      await expect(page).toHaveURL(/\/dashboard/);
    });
  });

  test.describe('Authentication Persistence', () => {
    test('should persist authentication across page reloads', async ({ page }) => {
      // Login
      await page.goto('/login');
      await page.getByLabel(/email/i).fill('test@example.com');
      await page.getByLabel(/password/i).fill('password123');
      await page.getByRole('button', { name: /sign in|log in/i }).click();

      await expect(page).toHaveURL(/\/dashboard/);

      // Reload page
      await page.reload();

      // Should still be on dashboard
      await expect(page).toHaveURL(/\/dashboard/);
    });

    test('should redirect to login when accessing protected routes without auth', async ({ page }) => {
      // Clear cookies/storage
      await page.context().clearCookies();

      await page.goto('/dashboard');

      // Should redirect to login
      await expect(page).toHaveURL(/\/login/);
    });

    test('should successfully logout', async ({ page }) => {
      // Login first
      await page.goto('/login');
      await page.getByLabel(/email/i).fill('test@example.com');
      await page.getByLabel(/password/i).fill('password123');
      await page.getByRole('button', { name: /sign in|log in/i }).click();

      await expect(page).toHaveURL(/\/dashboard/);

      // Find and click logout
      const userMenu = page.getByRole('button', { name: /user|account|profile/i });
      if (await userMenu.isVisible()) {
        await userMenu.click();
      }

      await page.getByRole('button', { name: /logout|sign out/i }).click();

      // Should redirect to login
      await expect(page).toHaveURL(/\/login/);
    });
  });
});
