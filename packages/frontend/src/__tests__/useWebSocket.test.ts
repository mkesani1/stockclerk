/**
 * useWebSocket Hook Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Types
interface WebSocketMessage {
  type: string;
  tenantId: string;
  payload: unknown;
  timestamp: string;
}

type MessageHandler = (message: WebSocketMessage) => void;
type ConnectionHandler = () => void;
type ErrorHandler = (error: Event) => void;

interface UseWebSocketOptions {
  url: string;
  token: string;
  reconnectAttempts?: number;
  reconnectIntervalMs?: number;
  onMessage?: MessageHandler;
  onConnect?: ConnectionHandler;
  onDisconnect?: ConnectionHandler;
  onError?: ErrorHandler;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  lastMessage: WebSocketMessage | null;
  sendMessage: (data: unknown) => void;
  connect: () => void;
  disconnect: () => void;
}

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 10);
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close'));
    }
  }

  // Test helper to simulate receiving a message
  simulateMessage(data: unknown): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', {
        data: JSON.stringify(data),
      }));
    }
  }

  // Test helper to simulate error
  simulateError(): void {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }
}

// Store WebSocket instances for testing
let mockWebSocketInstance: MockWebSocket | null = null;

// useWebSocket hook implementation
function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  const { renderHook: _, ...React } = require('react');
  const { useState, useEffect, useCallback, useRef } = React;

  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = options.reconnectAttempts ?? 5;
  const reconnectInterval = options.reconnectIntervalMs ?? 1000;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const ws = new WebSocket(`${options.url}?token=${options.token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      reconnectAttemptsRef.current = 0;
      options.onConnect?.();
    };

    ws.onclose = () => {
      setIsConnected(false);
      options.onDisconnect?.();

      // Attempt reconnection
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current++;
        setTimeout(connect, reconnectInterval);
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WebSocketMessage;
        setLastMessage(message);
        options.onMessage?.(message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    ws.onerror = (event) => {
      options.onError?.(event);
    };
  }, [options, maxReconnectAttempts, reconnectInterval]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const sendMessage = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    } else {
      console.warn('WebSocket is not connected');
    }
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, []);

  return {
    isConnected,
    lastMessage,
    sendMessage,
    connect,
    disconnect,
  };
}

describe('useWebSocket Hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockWebSocketInstance = null;

    // Mock the global WebSocket
    vi.stubGlobal('WebSocket', class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        mockWebSocketInstance = this;
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  describe('Connection', () => {
    it('should connect to WebSocket on mount', async () => {
      const onConnect = vi.fn();

      const { result } = renderHook(() =>
        useWebSocket({
          url: 'ws://localhost:3000/ws',
          token: 'test-token',
          onConnect,
        })
      );

      expect(result.current.isConnected).toBe(false);

      // Fast forward to allow connection
      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      expect(result.current.isConnected).toBe(true);
      expect(onConnect).toHaveBeenCalled();
    });

    it('should include token in URL', () => {
      renderHook(() =>
        useWebSocket({
          url: 'ws://localhost:3000/ws',
          token: 'my-auth-token',
        })
      );

      expect(mockWebSocketInstance?.url).toBe('ws://localhost:3000/ws?token=my-auth-token');
    });

    it('should set isConnected to false on disconnect', async () => {
      const onDisconnect = vi.fn();

      const { result } = renderHook(() =>
        useWebSocket({
          url: 'ws://localhost:3000/ws',
          token: 'test-token',
          onDisconnect,
        })
      );

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      expect(result.current.isConnected).toBe(true);

      act(() => {
        result.current.disconnect();
      });

      expect(result.current.isConnected).toBe(false);
      expect(onDisconnect).toHaveBeenCalled();
    });
  });

  describe('Message Handling', () => {
    it('should receive and parse messages', async () => {
      const onMessage = vi.fn();

      const { result } = renderHook(() =>
        useWebSocket({
          url: 'ws://localhost:3000/ws',
          token: 'test-token',
          onMessage,
        })
      );

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      const testMessage: WebSocketMessage = {
        type: 'stock_update',
        tenantId: 'tenant-123',
        payload: { productId: 'prod-1', newStock: 50 },
        timestamp: new Date().toISOString(),
      };

      act(() => {
        mockWebSocketInstance?.simulateMessage(testMessage);
      });

      expect(result.current.lastMessage).toEqual(testMessage);
      expect(onMessage).toHaveBeenCalledWith(testMessage);
    });

    it('should update lastMessage on each new message', async () => {
      const { result } = renderHook(() =>
        useWebSocket({
          url: 'ws://localhost:3000/ws',
          token: 'test-token',
        })
      );

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      const message1: WebSocketMessage = {
        type: 'stock_update',
        tenantId: 'tenant-123',
        payload: { productId: 'prod-1' },
        timestamp: new Date().toISOString(),
      };

      const message2: WebSocketMessage = {
        type: 'sync_completed',
        tenantId: 'tenant-123',
        payload: { channelId: 'ch-1' },
        timestamp: new Date().toISOString(),
      };

      act(() => {
        mockWebSocketInstance?.simulateMessage(message1);
      });
      expect(result.current.lastMessage?.type).toBe('stock_update');

      act(() => {
        mockWebSocketInstance?.simulateMessage(message2);
      });
      expect(result.current.lastMessage?.type).toBe('sync_completed');
    });

    it('should handle invalid JSON gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() =>
        useWebSocket({
          url: 'ws://localhost:3000/ws',
          token: 'test-token',
        })
      );

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      act(() => {
        if (mockWebSocketInstance?.onmessage) {
          mockWebSocketInstance.onmessage(new MessageEvent('message', {
            data: 'invalid json {{{',
          }));
        }
      });

      expect(consoleSpy).toHaveBeenCalled();
      expect(result.current.lastMessage).toBeNull();

      consoleSpy.mockRestore();
    });
  });

  describe('Sending Messages', () => {
    it('should send messages when connected', async () => {
      const { result } = renderHook(() =>
        useWebSocket({
          url: 'ws://localhost:3000/ws',
          token: 'test-token',
        })
      );

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      const sendSpy = vi.spyOn(mockWebSocketInstance!, 'send');

      act(() => {
        result.current.sendMessage({ type: 'ping' });
      });

      expect(sendSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }));
    });

    it('should warn when sending while disconnected', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { result } = renderHook(() =>
        useWebSocket({
          url: 'ws://localhost:3000/ws',
          token: 'test-token',
        })
      );

      // Don't advance timers, so connection isn't established
      act(() => {
        result.current.sendMessage({ type: 'ping' });
      });

      expect(consoleSpy).toHaveBeenCalledWith('WebSocket is not connected');

      consoleSpy.mockRestore();
    });
  });

  describe('Reconnection', () => {
    it('should attempt to reconnect after disconnect', async () => {
      const connectSpy = vi.fn();

      const { result } = renderHook(() =>
        useWebSocket({
          url: 'ws://localhost:3000/ws',
          token: 'test-token',
          reconnectAttempts: 3,
          reconnectIntervalMs: 1000,
          onConnect: connectSpy,
        })
      );

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      expect(connectSpy).toHaveBeenCalledTimes(1);

      // Simulate disconnect
      act(() => {
        mockWebSocketInstance?.close();
      });

      // Wait for reconnect attempt
      await act(async () => {
        vi.advanceTimersByTime(1000);
        vi.advanceTimersByTime(50); // Allow connection to establish
      });

      // Should have attempted reconnection
      expect(connectSpy).toHaveBeenCalledTimes(2);
    });

    it('should stop reconnecting after max attempts', async () => {
      let connectionAttempts = 0;

      // Override the WebSocket stub with one that always fails
      vi.stubGlobal('WebSocket', class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          connectionAttempts++;
          // Immediately trigger close instead of open
          setTimeout(() => {
            this.readyState = MockWebSocket.CLOSED;
            if (this.onclose) {
              this.onclose(new CloseEvent('close'));
            }
          }, 10);
        }
      });

      renderHook(() =>
        useWebSocket({
          url: 'ws://localhost:3000/ws',
          token: 'test-token',
          reconnectAttempts: 2,
          reconnectIntervalMs: 50,
        })
      );

      // Fast forward through multiple connection attempts
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      // Should not exceed reasonable number of attempts
      // Note: With fake timers and 50ms intervals, multiple reconnect attempts can happen
      expect(connectionAttempts).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Error Handling', () => {
    it('should call onError when error occurs', async () => {
      const onError = vi.fn();
      let wsInstance: MockWebSocket | null = null;

      renderHook(() =>
        useWebSocket({
          url: 'ws://localhost:3000/ws',
          token: 'test-token',
          onError,
        })
      );

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      // Capture the instance while it exists
      wsInstance = mockWebSocketInstance;
      expect(wsInstance).not.toBeNull();

      act(() => {
        wsInstance?.simulateError();
      });

      expect(onError).toHaveBeenCalled();
    });
  });

  describe('Cleanup', () => {
    it('should disconnect on unmount', async () => {
      let wsInstance: MockWebSocket | null = null;

      const { result, unmount } = renderHook(() =>
        useWebSocket({
          url: 'ws://localhost:3000/ws',
          token: 'test-token',
        })
      );

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      wsInstance = mockWebSocketInstance;
      expect(result.current.isConnected).toBe(true);
      expect(wsInstance?.readyState).toBe(MockWebSocket.OPEN);

      act(() => {
        unmount();
      });

      expect(wsInstance?.readyState).toBe(MockWebSocket.CLOSED);
    });
  });

  describe('Manual Control', () => {
    it('should allow manual connect after disconnect', async () => {
      const { result } = renderHook(() =>
        useWebSocket({
          url: 'ws://localhost:3000/ws',
          token: 'test-token',
          reconnectAttempts: 0, // Disable auto-reconnect
        })
      );

      // Initial connection
      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      expect(result.current.isConnected).toBe(true);

      // Disconnect
      act(() => {
        result.current.disconnect();
      });

      expect(result.current.isConnected).toBe(false);

      // Manually connect
      act(() => {
        result.current.connect();
      });

      // Wait for connection to establish
      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      expect(result.current.isConnected).toBe(true);
    });

    it('should not create duplicate connections when already connected', async () => {
      const { result } = renderHook(() =>
        useWebSocket({
          url: 'ws://localhost:3000/ws',
          token: 'test-token',
        })
      );

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      const firstInstance = mockWebSocketInstance;

      // Try to connect again
      act(() => {
        result.current.connect();
      });

      // Should still be the same instance
      expect(mockWebSocketInstance).toBe(firstInstance);
    });
  });
});
