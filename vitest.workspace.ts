/**
 * Vitest Workspace Configuration
 * Enables running tests across all packages
 */

import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/backend',
  'packages/frontend',
  'packages/sync-engine',
  'packages/integrations',
]);
