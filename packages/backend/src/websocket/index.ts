/**
 * WebSocket Handler with Real-time Updates
 * Supports room-based connections, heartbeat, and typed message events
 */

import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import type {
  WebSocketMessage,
  WebSocketEventType,
  JWTPayload,
  StockUpdatePayload,
  SyncEventPayload,
  AlertPayload,
  ChannelType,
  SyncEventStatus,
  AlertType,
} from '../types/index.js';

// Connection state tracking
interface ConnectionState {
  ws: WebSocket;
  userId: string;
  email: string;
  tenantId: string;
  lastPing: number;
  isAlive: boolean;
  subscriptions: Set<string>; // Rooms/topics subscribed to
}

// Store active WebSocket connections by tenant
const connectionsByTenant = new Map<string, Map<string, ConnectionState>>();

// Heartbeat interval (30 seconds)
const HEARTBEAT_INTERVAL = 30000;
const HEARTBEAT_TIMEOUT = 10000;

// Global heartbeat interval reference
let heartbeatInterval: NodeJS.Timeout | null = null;

// Message type definitions
export type WebSocketMessageType =
  | 'connected'
  | 'error'
  | 'ping'
  | 'pong'
  | 'sync:started'
  | 'sync:completed'
  | 'sync:error'
  | 'stock:updated'
  | 'alert:new'
  | 'channel:status'
  | 'subscribe'
  | 'unsubscribe';

// Incoming client message types
interface ClientMessage {
  type: WebSocketMessageType;
  data?: Record<string, unknown>;
  room?: string;
}

// Register WebSocket routes
export async function registerWebSocketRoutes(app: FastifyInstance): Promise<void> {
  // Start heartbeat checker
  startHeartbeat(app);

  app.get('/ws', { websocket: true }, (connection, request) => {
    const ws = connection;

    // Extract token from query string for authentication
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      sendMessage(ws, {
        type: 'error',
        tenantId: '',
        payload: { message: 'Authentication required' },
        timestamp: new Date().toISOString(),
      });
      ws.close(4001, 'Unauthorized');
      return;
    }

    // Verify JWT token
    let user: JWTPayload;
    try {
      user = app.jwt.verify<JWTPayload>(token);
    } catch (error) {
      sendMessage(ws, {
        type: 'error',
        tenantId: '',
        payload: { message: 'Invalid token' },
        timestamp: new Date().toISOString(),
      });
      ws.close(4001, 'Unauthorized');
      return;
    }

    const tenantId = user.tenantId;
    const connectionId = `${user.userId}-${Date.now()}`;

    // Create connection state
    const connectionState: ConnectionState = {
      ws,
      userId: user.userId,
      email: user.email,
      tenantId,
      lastPing: Date.now(),
      isAlive: true,
      subscriptions: new Set(['*']), // Subscribe to all tenant events by default
    };

    // Add connection to tenant's connection map
    if (!connectionsByTenant.has(tenantId)) {
      connectionsByTenant.set(tenantId, new Map());
    }
    connectionsByTenant.get(tenantId)!.set(connectionId, connectionState);

    app.log.info(`WebSocket connected: tenant=${tenantId}, user=${user.email}, connectionId=${connectionId}`);

    // Send welcome message
    sendMessage(ws, {
      type: 'connected',
      tenantId,
      payload: {
        message: 'Connected to StockClerk real-time updates',
        connectionId,
        tenantId,
        userId: user.userId,
        subscribedRooms: ['*'],
      },
      timestamp: new Date().toISOString(),
    });

    // Handle incoming messages
    ws.on('message', (message: Buffer) => {
      try {
        const data: ClientMessage = JSON.parse(message.toString());
        handleClientMessage(app, ws, connectionState, data, connectionId);
      } catch (error) {
        app.log.error('Failed to parse WebSocket message:', error);
        sendMessage(ws, {
          type: 'error',
          tenantId,
          payload: { message: 'Invalid message format' },
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Handle pong for heartbeat
    ws.on('pong', () => {
      connectionState.isAlive = true;
      connectionState.lastPing = Date.now();
    });

    // Handle connection close
    ws.on('close', (code, reason) => {
      app.log.info(`WebSocket disconnected: tenant=${tenantId}, connectionId=${connectionId}, code=${code}`);
      removeConnection(tenantId, connectionId);
    });

    // Handle errors
    ws.on('error', (error) => {
      app.log.error(`WebSocket error: tenant=${tenantId}, connectionId=${connectionId}`, error);
      removeConnection(tenantId, connectionId);
    });
  });
}

// Handle incoming client messages
function handleClientMessage(
  app: FastifyInstance,
  ws: WebSocket,
  state: ConnectionState,
  message: ClientMessage,
  connectionId: string
): void {
  switch (message.type) {
    case 'ping':
      // Respond with pong
      state.lastPing = Date.now();
      state.isAlive = true;
      sendMessage(ws, {
        type: 'pong',
        tenantId: state.tenantId,
        payload: { timestamp: Date.now() },
        timestamp: new Date().toISOString(),
      });
      break;

    case 'subscribe':
      // Subscribe to a specific room/topic
      if (message.room) {
        state.subscriptions.add(message.room);
        app.log.debug(`Connection ${connectionId} subscribed to room: ${message.room}`);
        sendMessage(ws, {
          type: 'subscribe',
          tenantId: state.tenantId,
          payload: {
            room: message.room,
            status: 'subscribed',
            subscribedRooms: Array.from(state.subscriptions),
          },
          timestamp: new Date().toISOString(),
        });
      }
      break;

    case 'unsubscribe':
      // Unsubscribe from a room/topic
      if (message.room && message.room !== '*') {
        state.subscriptions.delete(message.room);
        app.log.debug(`Connection ${connectionId} unsubscribed from room: ${message.room}`);
        sendMessage(ws, {
          type: 'unsubscribe',
          tenantId: state.tenantId,
          payload: {
            room: message.room,
            status: 'unsubscribed',
            subscribedRooms: Array.from(state.subscriptions),
          },
          timestamp: new Date().toISOString(),
        });
      }
      break;

    default:
      app.log.debug(`Received message type: ${message.type}`, message.data);
  }
}

// Remove a connection
function removeConnection(tenantId: string, connectionId: string): void {
  const tenantConnections = connectionsByTenant.get(tenantId);
  if (tenantConnections) {
    tenantConnections.delete(connectionId);
    if (tenantConnections.size === 0) {
      connectionsByTenant.delete(tenantId);
    }
  }
}

// Send a message to a WebSocket
function sendMessage<T>(ws: WebSocket, message: WebSocketMessage<T>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// Start heartbeat checker
function startHeartbeat(app: FastifyInstance): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  heartbeatInterval = setInterval(() => {
    const now = Date.now();

    for (const [tenantId, connections] of connectionsByTenant) {
      for (const [connectionId, state] of connections) {
        // Check if connection is still alive
        if (!state.isAlive) {
          app.log.info(`Terminating inactive connection: tenant=${tenantId}, connectionId=${connectionId}`);
          state.ws.terminate();
          removeConnection(tenantId, connectionId);
          continue;
        }

        // Check for timeout
        if (now - state.lastPing > HEARTBEAT_INTERVAL + HEARTBEAT_TIMEOUT) {
          app.log.info(`Connection timeout: tenant=${tenantId}, connectionId=${connectionId}`);
          state.ws.terminate();
          removeConnection(tenantId, connectionId);
          continue;
        }

        // Send ping
        state.isAlive = false;
        if (state.ws.readyState === WebSocket.OPEN) {
          state.ws.ping();
        }
      }
    }
  }, HEARTBEAT_INTERVAL);
}

// Stop heartbeat checker (for cleanup)
export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// ============================================================================
// Broadcast Functions
// ============================================================================

// Broadcast message to all connections for a specific tenant
export function broadcastToTenant<T>(tenantId: string, message: WebSocketMessage<T>): void {
  const tenantConnections = connectionsByTenant.get(tenantId);
  if (!tenantConnections || tenantConnections.size === 0) {
    return;
  }

  const messageStr = JSON.stringify(message);

  for (const [, state] of tenantConnections) {
    if (state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(messageStr);
    }
  }
}

// Broadcast message to specific room within a tenant
export function broadcastToRoom<T>(
  tenantId: string,
  room: string,
  message: WebSocketMessage<T>
): void {
  const tenantConnections = connectionsByTenant.get(tenantId);
  if (!tenantConnections || tenantConnections.size === 0) {
    return;
  }

  const messageStr = JSON.stringify(message);

  for (const [, state] of tenantConnections) {
    // Check if connection is subscribed to this room or all (*)
    if (
      state.ws.readyState === WebSocket.OPEN &&
      (state.subscriptions.has('*') || state.subscriptions.has(room))
    ) {
      state.ws.send(messageStr);
    }
  }
}

// Broadcast message to all connected clients (system-wide)
export function broadcastToAll<T>(message: WebSocketMessage<T>): void {
  const messageStr = JSON.stringify(message);

  for (const [, connections] of connectionsByTenant) {
    for (const [, state] of connections) {
      if (state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(messageStr);
      }
    }
  }
}

// ============================================================================
// Typed Event Emitters
// ============================================================================

// Emit sync:started event
export function emitSyncStarted(
  tenantId: string,
  data: {
    syncEventId?: string;
    channelId: string;
    channelName: string;
    channelType: ChannelType;
    operation: string;
  }
): void {
  broadcastToTenant(
    tenantId,
    createWebSocketMessage('sync_started', tenantId, data)
  );
}

// Emit sync:completed event
export function emitSyncCompleted(
  tenantId: string,
  data: {
    syncEventId: string;
    channelId: string;
    channelName: string;
    channelType: ChannelType;
    productsUpdated: number;
    duration: number;
  }
): void {
  broadcastToTenant(
    tenantId,
    createWebSocketMessage('sync_completed', tenantId, data)
  );
}

// Emit sync:error event
export function emitSyncError(
  tenantId: string,
  data: {
    syncEventId?: string;
    channelId: string;
    channelName: string;
    channelType: ChannelType;
    error: string;
    retryable: boolean;
  }
): void {
  broadcastToTenant(
    tenantId,
    createWebSocketMessage('sync_failed', tenantId, data)
  );
}

// Emit stock:updated event
export function emitStockUpdated(
  tenantId: string,
  data: StockUpdatePayload
): void {
  // Broadcast to both general and product-specific rooms
  const message = createWebSocketMessage('stock_update', tenantId, data);
  broadcastToTenant(tenantId, message);
  broadcastToRoom(tenantId, `product:${data.productId}`, message);
}

// Emit alert:new event
export function emitAlertNew(
  tenantId: string,
  data: AlertPayload
): void {
  broadcastToTenant(
    tenantId,
    createWebSocketMessage('alert_created', tenantId, data)
  );
}

// Emit channel:status event
export function emitChannelStatus(
  tenantId: string,
  data: {
    channelId: string;
    channelName: string;
    channelType: ChannelType;
    status: 'connected' | 'disconnected' | 'error' | 'syncing';
    message?: string;
  }
): void {
  const eventType: WebSocketEventType =
    data.status === 'connected' ? 'channel_connected' : 'channel_disconnected';

  broadcastToTenant(tenantId, createWebSocketMessage(eventType, tenantId, data));
}

// ============================================================================
// Connection Statistics
// ============================================================================

// Get connection count for a tenant
export function getTenantConnectionCount(tenantId: string): number {
  return connectionsByTenant.get(tenantId)?.size || 0;
}

// Get total connection count
export function getTotalConnectionCount(): number {
  let total = 0;
  for (const [, connections] of connectionsByTenant) {
    total += connections.size;
  }
  return total;
}

// Get connection statistics
export function getConnectionStats(): {
  totalConnections: number;
  tenantCount: number;
  connectionsByTenant: Record<string, number>;
} {
  const stats: Record<string, number> = {};
  let total = 0;

  for (const [tenantId, connections] of connectionsByTenant) {
    stats[tenantId] = connections.size;
    total += connections.size;
  }

  return {
    totalConnections: total,
    tenantCount: connectionsByTenant.size,
    connectionsByTenant: stats,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

// Helper to create typed WebSocket messages
export function createWebSocketMessage<T>(
  type: WebSocketEventType,
  tenantId: string,
  payload: T
): WebSocketMessage<T> {
  return {
    type,
    tenantId,
    payload,
    timestamp: new Date().toISOString(),
  };
}

// Close all connections for a tenant (e.g., when tenant is deleted)
export function closeAllTenantConnections(tenantId: string, reason = 'Tenant disconnected'): void {
  const tenantConnections = connectionsByTenant.get(tenantId);
  if (!tenantConnections) return;

  for (const [connectionId, state] of tenantConnections) {
    state.ws.close(1000, reason);
  }

  connectionsByTenant.delete(tenantId);
}

// Close all connections (for graceful shutdown)
export function closeAllConnections(reason = 'Server shutdown'): void {
  for (const [tenantId, connections] of connectionsByTenant) {
    for (const [, state] of connections) {
      state.ws.close(1000, reason);
    }
  }
  connectionsByTenant.clear();
  stopHeartbeat();
}

export default registerWebSocketRoutes;
