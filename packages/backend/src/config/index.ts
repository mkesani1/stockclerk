import { z } from 'zod';

// Environment configuration schema
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),

  // Database
  DATABASE_URL: z.string().url().default('postgresql://stockclerk:stockclerk_dev@localhost:5432/stockclerk'),

  // Redis
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // JWT
  JWT_SECRET: z.string().min(32).default('stockclerk-development-secret-key-32chars'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:3000'),

  // Encryption (for storing channel credentials)
  ENCRYPTION_KEY: z.string().min(32).default('stockclerk-encryption-key-32chars'),

  // Frontend URL
  FRONTEND_URL: z.string().default('http://localhost:5173'),

  // Sync Engine
  SYNC_INTERVAL_MS: z.coerce.number().default(30000),
  SYNC_BATCH_SIZE: z.coerce.number().default(100),
  SYNC_MAX_RETRIES: z.coerce.number().default(3),

  // Guardian
  RECONCILIATION_INTERVAL_MS: z.coerce.number().default(900000),
  DRIFT_AUTO_REPAIR_THRESHOLD: z.coerce.number().default(5),
  LOW_STOCK_THRESHOLD: z.coerce.number().default(10),
});

// Parse and validate environment variables
function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment configuration:');
    console.error(result.error.format());
    // In production, we might want to throw here
    // For development, use defaults
    return envSchema.parse({});
  }

  return result.data;
}

export const config = loadConfig();

export type Config = z.infer<typeof envSchema>;

export default config;
