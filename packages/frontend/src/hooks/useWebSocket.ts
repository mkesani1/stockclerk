import { useEffect, useRef, useState, useCallback } from 'react';
import type { WSEvent } from '../types';
import type { AgentStatus } from '../components/agents';
import type { SyncActivityItemData } from '../components/activity';
import type { SyncProgressData } from '../components/sync';
import type { StockChangeData } from '../components/products';
import type { ChannelType } from '../types';

// Extended WebSocket event types
export type WSEventType =
  | 'sync_update'
  | 'stock_change'
  | 'channel_status'
  | 'agent_activity'
  | 'alert'
  | 'agent:status'
  | 'sync:progress'
  | 'activity:new';

// Agent status update payload
export interface AgentStatusPayload {
  agentId: string;
  status: AgentStatus;
  lastAction?: string;
  jobsProcessed?: number;
  lastActionDescription?: string;
}

// Sync progress payload
export interface SyncProgressPayload extends SyncProgressData {}

// Activity payload
export interface ActivityPayload extends SyncActivityItemData {}

// Stock change payload
export interface StockChangePayload extends StockChangeData {}

// Extended WS Event interface
export interface ExtendedWSEvent<T = unknown> {
  type: WSEventType;
  payload: T;
  timestamp: string;
}

interface UseWebSocketOptions {
  url?: string;
  onMessage?: (event: ExtendedWSEvent) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onAgentStatus?: (payload: AgentStatusPayload) => void;
  onSyncProgress?: (payload: SyncProgressPayload | null) => void;
  onNewActivity?: (payload: ActivityPayload) => void;
  onStockChange?: (payload: StockChangePayload) => void;
  reconnectAttempts?: number;
  reconnectInterval?: number;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  isReconnecting: boolean;
  lastMessage: ExtendedWSEvent | null;
  sendMessage: (data: unknown) => void;
  connect: () => void;
  disconnect: () => void;
  // New typed message handlers
  subscribeToAgentStatus: (callback: (payload: AgentStatusPayload) => void) => () => void;
  subscribeToSyncProgress: (callback: (payload: SyncProgressPayload | null) => void) => () => void;
  subscribeToActivity: (callback: (payload: ActivityPayload) => void) => () => void;
  subscribeToStockChange: (callback: (payload: StockChangePayload) => void) => () => void;
}

export const useWebSocket = (options: UseWebSocketOptions = {}): UseWebSocketReturn => {
  const {
    url = import.meta.env.VITE_WS_URL || 'ws://localhost:3001',
    onMessage,
    onConnect,
    onDisconnect,
    onAgentStatus,
    onSyncProgress,
    onNewActivity,
    onStockChange,
    reconnectAttempts = 5,
    reconnectInterval = 3000,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subscribersRef = useRef<{
    agentStatus: Set<(payload: AgentStatusPayload) => void>;
    syncProgress: Set<(payload: SyncProgressPayload | null) => void>;
    activity: Set<(payload: ActivityPayload) => void>;
    stockChange: Set<(payload: StockChangePayload) => void>;
  }>({
    agentStatus: new Set(),
    syncProgress: new Set(),
    activity: new Set(),
    stockChange: new Set(),
  });

  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [lastMessage, setLastMessage] = useState<ExtendedWSEvent | null>(null);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  // Dispatch events to DOM for component-level listeners
  const dispatchCustomEvent = useCallback((type: string, detail: unknown) => {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }, []);

  // Process incoming messages and dispatch to appropriate handlers
  const processMessage = useCallback((data: ExtendedWSEvent) => {
    switch (data.type) {
      case 'agent:status': {
        const payload = data.payload as AgentStatusPayload;
        onAgentStatus?.(payload);
        subscribersRef.current.agentStatus.forEach((cb) => cb(payload));
        dispatchCustomEvent('agent:status', payload);
        break;
      }
      case 'sync:progress': {
        const payload = data.payload as SyncProgressPayload | null;
        onSyncProgress?.(payload);
        subscribersRef.current.syncProgress.forEach((cb) => cb(payload));
        dispatchCustomEvent('sync:progress', payload);
        break;
      }
      case 'activity:new': {
        const payload = data.payload as ActivityPayload;
        onNewActivity?.(payload);
        subscribersRef.current.activity.forEach((cb) => cb(payload));
        dispatchCustomEvent('activity:new', payload);
        break;
      }
      case 'stock_change': {
        const payload = data.payload as StockChangePayload;
        onStockChange?.(payload);
        subscribersRef.current.stockChange.forEach((cb) => cb(payload));
        dispatchCustomEvent('stock:external_change', payload);
        break;
      }
      default:
        // Pass through other events
        break;
    }
  }, [onAgentStatus, onSyncProgress, onNewActivity, onStockChange, dispatchCustomEvent]);

  const connect = useCallback(() => {
    // Don't connect in development if no WS server
    if (!url || url.includes('undefined')) {
      console.log('[WebSocket] No URL configured, using mock mode');
      setIsConnected(true);
      return;
    }

    try {
      wsRef.current = new WebSocket(url);

      wsRef.current.onopen = () => {
        console.log('[WebSocket] Connected');
        setIsConnected(true);
        setIsReconnecting(false);
        reconnectCountRef.current = 0;
        onConnect?.();
      };

      wsRef.current.onclose = () => {
        console.log('[WebSocket] Disconnected');
        setIsConnected(false);
        onDisconnect?.();

        // Attempt to reconnect
        if (reconnectCountRef.current < reconnectAttempts) {
          setIsReconnecting(true);
          reconnectCountRef.current++;
          console.log(`[WebSocket] Reconnecting (${reconnectCountRef.current}/${reconnectAttempts})...`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        } else {
          setIsReconnecting(false);
          console.log('[WebSocket] Max reconnection attempts reached');
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ExtendedWSEvent;
          setLastMessage(data);
          onMessage?.(data);
          processMessage(data);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };
    } catch (error) {
      console.error('[WebSocket] Failed to connect:', error);
    }
  }, [url, onMessage, onConnect, onDisconnect, reconnectAttempts, reconnectInterval, processMessage]);

  const disconnect = useCallback(() => {
    clearReconnectTimeout();
    reconnectCountRef.current = reconnectAttempts; // Prevent auto-reconnect

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [clearReconnectTimeout, reconnectAttempts]);

  const sendMessage = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    } else {
      console.warn('[WebSocket] Cannot send message - not connected');
    }
  }, []);

  // Subscription methods for typed event handlers
  const subscribeToAgentStatus = useCallback((callback: (payload: AgentStatusPayload) => void) => {
    subscribersRef.current.agentStatus.add(callback);
    return () => {
      subscribersRef.current.agentStatus.delete(callback);
    };
  }, []);

  const subscribeToSyncProgress = useCallback((callback: (payload: SyncProgressPayload | null) => void) => {
    subscribersRef.current.syncProgress.add(callback);
    return () => {
      subscribersRef.current.syncProgress.delete(callback);
    };
  }, []);

  const subscribeToActivity = useCallback((callback: (payload: ActivityPayload) => void) => {
    subscribersRef.current.activity.add(callback);
    return () => {
      subscribersRef.current.activity.delete(callback);
    };
  }, []);

  const subscribeToStockChange = useCallback((callback: (payload: StockChangePayload) => void) => {
    subscribersRef.current.stockChange.add(callback);
    return () => {
      subscribersRef.current.stockChange.delete(callback);
    };
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    connect();

    return () => {
      clearReconnectTimeout();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect, clearReconnectTimeout]);

  return {
    isConnected,
    isReconnecting,
    lastMessage,
    sendMessage,
    connect,
    disconnect,
    subscribeToAgentStatus,
    subscribeToSyncProgress,
    subscribeToActivity,
    subscribeToStockChange,
  };
};

// Hook for subscribing to specific event types
export const useWebSocketEvent = <T = unknown>(
  eventType: WSEventType,
  callback: (payload: T) => void
) => {
  const { lastMessage } = useWebSocket();

  useEffect(() => {
    if (lastMessage && lastMessage.type === eventType) {
      callback(lastMessage.payload as T);
    }
  }, [lastMessage, eventType, callback]);
};

// Hook specifically for agent status updates
export const useAgentStatusUpdates = (callback: (payload: AgentStatusPayload) => void) => {
  const { subscribeToAgentStatus } = useWebSocket();

  useEffect(() => {
    const unsubscribe = subscribeToAgentStatus(callback);
    return unsubscribe;
  }, [subscribeToAgentStatus, callback]);
};

// Hook specifically for sync progress updates
export const useSyncProgressUpdates = (callback: (payload: SyncProgressPayload | null) => void) => {
  const { subscribeToSyncProgress } = useWebSocket();

  useEffect(() => {
    const unsubscribe = subscribeToSyncProgress(callback);
    return unsubscribe;
  }, [subscribeToSyncProgress, callback]);
};

// Hook specifically for new activity updates
export const useActivityUpdates = (callback: (payload: ActivityPayload) => void) => {
  const { subscribeToActivity } = useWebSocket();

  useEffect(() => {
    const unsubscribe = subscribeToActivity(callback);
    return unsubscribe;
  }, [subscribeToActivity, callback]);
};

// Hook specifically for stock change updates
export const useStockChangeUpdates = (callback: (payload: StockChangePayload) => void) => {
  const { subscribeToStockChange } = useWebSocket();

  useEffect(() => {
    const unsubscribe = subscribeToStockChange(callback);
    return unsubscribe;
  }, [subscribeToStockChange, callback]);
};
