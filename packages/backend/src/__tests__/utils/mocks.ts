/**
 * Test Mocks
 * Mock implementations for external dependencies
 */

import { vi } from 'vitest';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { JWTPayload } from '../../types/index.js';
import { createTenantFixture, createUserFixture, createChannelFixture } from './fixtures.js';

// ============================================================================
// Fastify Mocks
// ============================================================================

export function createMockFastifyInstance(): Partial<FastifyInstance> {
  return {
    jwt: {
      sign: vi.fn((payload: JWTPayload) => `mock-jwt-token-${payload.userId}`),
      verify: vi.fn((token: string) => ({
        userId: 'mock-user-id',
        tenantId: 'mock-tenant-id',
        email: 'test@example.com',
        role: 'owner',
      })),
      decode: vi.fn(),
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      })),
    } as any,
    addHook: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    register: vi.fn(),
  };
}

export function createMockRequest(overrides: Partial<FastifyRequest> = {}): Partial<FastifyRequest> {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    user: undefined,
    ...overrides,
  };
}

export function createMockReply(): {
  reply: Partial<FastifyReply>;
  getSentData: () => { code: number; body: unknown } | null;
} {
  let sentData: { code: number; body: unknown } | null = null;

  const reply: Partial<FastifyReply> = {
    code: vi.fn(function (this: Partial<FastifyReply>, statusCode: number) {
      sentData = { code: statusCode, body: null };
      return this;
    }),
    send: vi.fn(function (this: Partial<FastifyReply>, body: unknown) {
      if (sentData) {
        sentData.body = body;
      } else {
        sentData = { code: 200, body };
      }
      return this;
    }),
    header: vi.fn().mockReturnThis(),
  };

  return {
    reply,
    getSentData: () => sentData,
  };
}

export function createAuthenticatedRequest(
  jwtPayload?: Partial<JWTPayload>,
  overrides: Partial<FastifyRequest> = {}
): Partial<FastifyRequest> {
  const tenant = createTenantFixture();
  const user = createUserFixture({ tenantId: tenant.id });

  return {
    ...createMockRequest(overrides),
    user: {
      userId: user.id,
      tenantId: tenant.id,
      email: user.email,
      role: user.role,
      ...jwtPayload,
    },
  };
}

// ============================================================================
// Database Mocks
// ============================================================================

export const mockDb = {
  query: {
    tenants: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    users: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    channels: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    products: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    productChannelMappings: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    syncEvents: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    alerts: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(),
      })),
    })),
  })),
  delete: vi.fn(() => ({
    where: vi.fn(() => ({
      returning: vi.fn(),
    })),
  })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => [{ count: 0 }]),
    })),
  })),
  transaction: vi.fn(async (callback) => {
    return callback({
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(),
        })),
      })),
    });
  }),
};

export function resetMockDb(): void {
  Object.values(mockDb.query).forEach((table) => {
    Object.values(table).forEach((fn) => {
      if (typeof fn === 'function' && 'mockReset' in fn) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    });
  });
  mockDb.insert.mockReset();
  mockDb.update.mockReset();
  mockDb.delete.mockReset();
  mockDb.select.mockReset();
  mockDb.transaction.mockReset();
}

// ============================================================================
// BullMQ Mocks
// ============================================================================

export const mockQueue = {
  add: vi.fn(),
  addBulk: vi.fn(),
  getJob: vi.fn(),
  getJobs: vi.fn(),
  obliterate: vi.fn(),
  close: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
};

export const mockWorker = {
  on: vi.fn(),
  run: vi.fn(),
  close: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
};

export function createMockBullMQ() {
  return {
    Queue: vi.fn(() => mockQueue),
    Worker: vi.fn(() => mockWorker),
    QueueScheduler: vi.fn(),
    QueueEvents: vi.fn(() => ({
      on: vi.fn(),
      close: vi.fn(),
    })),
  };
}

// ============================================================================
// Redis Mocks
// ============================================================================

export const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  expire: vi.fn(),
  hget: vi.fn(),
  hset: vi.fn(),
  hdel: vi.fn(),
  hgetall: vi.fn(),
  publish: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  on: vi.fn(),
  quit: vi.fn(),
  disconnect: vi.fn(),
};

export function createMockRedis() {
  return vi.fn(() => mockRedis);
}

// ============================================================================
// WebSocket Mocks
// ============================================================================

export const mockWebSocket = {
  send: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
  ping: vi.fn(),
  pong: vi.fn(),
  readyState: 1, // OPEN
  OPEN: 1,
  CLOSED: 3,
};

export function createMockWebSocketConnection() {
  return {
    socket: mockWebSocket,
    tenantId: 'mock-tenant-id',
    userId: 'mock-user-id',
  };
}

// ============================================================================
// bcryptjs Mocks
// ============================================================================

export const mockBcrypt = {
  hash: vi.fn(async (password: string) => `hashed_${password}`),
  compare: vi.fn(async (password: string, hash: string) => hash === `hashed_${password}`),
};

// ============================================================================
// External API Mocks
// ============================================================================

export const mockAxios = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  create: vi.fn(() => mockAxios),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
};

export function createMockAxiosResponse(data: unknown, status = 200) {
  return {
    data,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {},
    config: {},
  };
}

// ============================================================================
// Crypto Mocks
// ============================================================================

export const mockCrypto = {
  randomBytes: vi.fn((size: number) => Buffer.alloc(size, 'a')),
  createHmac: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn(() => 'mock-hmac-digest'),
  })),
  createCipheriv: vi.fn(() => ({
    update: vi.fn(() => 'encrypted'),
    final: vi.fn(() => ''),
    getAuthTag: vi.fn(() => Buffer.from('auth-tag')),
  })),
  createDecipheriv: vi.fn(() => ({
    setAuthTag: vi.fn(),
    update: vi.fn(() => '{"decrypted": true}'),
    final: vi.fn(() => ''),
  })),
  scryptSync: vi.fn(() => Buffer.alloc(32, 'k')),
  timingSafeEqual: vi.fn((a: Buffer, b: Buffer) => a.equals(b)),
};

// ============================================================================
// Console Mocks (for suppressing logs in tests)
// ============================================================================

export function suppressConsoleLogs() {
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

  beforeEach(() => {
    console.log = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
    console.info = vi.fn();
    console.debug = vi.fn();
  });

  afterEach(() => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
  });
}

// ============================================================================
// Time Mocks
// ============================================================================

export function mockDate(date: Date | string) {
  const fixedDate = typeof date === 'string' ? new Date(date) : date;
  vi.useFakeTimers();
  vi.setSystemTime(fixedDate);
  return () => vi.useRealTimers();
}

// ============================================================================
// Environment Mocks
// ============================================================================

export function mockEnv(env: Record<string, string>) {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, env);
  });

  afterEach(() => {
    Object.keys(env).forEach((key) => {
      if (key in originalEnv) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    });
  });
}
