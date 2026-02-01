// Export all route modules
export { authRoutes } from './auth.js';
export { healthRoutes } from './health.js';
export { channelRoutes, wixOAuthPublicRoutes } from './channels.js';
export { productRoutes } from './products.js';
export { alertRoutes, getAlertRulesForTenant, getLowStockThresholds } from './alerts.js';
export { syncRoutes } from './sync.js';
export { webhookRoutes } from './webhooks.js';
export { dashboardRoutes, updateAgentStatus, getAgentStatus } from './dashboard.js';
