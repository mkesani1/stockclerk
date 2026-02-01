/**
 * API Hooks for StockSync Hub Frontend
 * React Query-based hooks with real API integration + mock fallbacks
 */

import { QueryClient, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios, { AxiosError } from 'axios';
import { useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import type {
  Product,
  Channel,
  Agent,
  SyncActivity,
  DashboardStats,
  ApiResponse,
  PaginatedResponse,
} from '../types';

// API Base URL
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
const WS_BASE_URL = import.meta.env.VITE_WS_URL || `ws://${window.location.host}`;

// Feature flag for using real API vs mock data
const USE_REAL_API = import.meta.env.VITE_USE_REAL_API === 'true';

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Add auth interceptor
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
      // Redirect to login if not already there
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Query client configuration
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 3,
      refetchOnWindowFocus: false,
    },
  },
});

// ============ Query Keys ============

export const queryKeys = {
  products: ['products'] as const,
  product: (id: string) => ['products', id] as const,
  channels: ['channels'] as const,
  channel: (id: string) => ['channels', id] as const,
  alerts: ['alerts'] as const,
  alertsUnread: ['alerts', 'unread'] as const,
  dashboard: ['dashboard'] as const,
  dashboardStats: ['dashboard', 'stats'] as const,
  agents: ['agents'] as const,
  syncActivity: ['sync', 'activity'] as const,
  syncStatus: ['sync', 'status'] as const,
};

// ============ Dashboard Hooks ============

export const useDashboardStats = () => {
  return useQuery<DashboardStats>({
    queryKey: ['dashboard', 'stats'],
    queryFn: async () => {
      // Mock data for development
      return {
        totalProducts: 156,
        syncedToday: 42,
        activeChannels: 3,
        alertsCount: 2,
      };
    },
  });
};

export const useAgents = () => {
  return useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: async () => {
      // Mock data for development
      return [
        {
          id: '1',
          type: 'watcher',
          name: 'Stock Watcher',
          status: 'active',
          lastActivity: new Date().toISOString(),
          tasksCompleted: 234,
          icon: String.fromCodePoint(0x25C9),
        },
        {
          id: '2',
          type: 'sync',
          name: 'Sync Engine',
          status: 'processing',
          lastActivity: new Date().toISOString(),
          tasksCompleted: 1523,
          icon: String.fromCodePoint(0x21BB),
        },
        {
          id: '3',
          type: 'guardian',
          name: 'Stock Guardian',
          status: 'active',
          lastActivity: new Date().toISOString(),
          tasksCompleted: 89,
          icon: String.fromCodePoint(0x2B21),
        },
        {
          id: '4',
          type: 'alert',
          name: 'Alert Manager',
          status: 'idle',
          lastActivity: new Date().toISOString(),
          tasksCompleted: 12,
          icon: String.fromCodePoint(0x2691),
        },
      ];
    },
  });
};

export const useSyncActivity = (limit = 10) => {
  return useQuery<SyncActivity[]>({
    queryKey: ['sync', 'activity', limit],
    queryFn: async (): Promise<SyncActivity[]> => {
      // Mock data for development
      const now = new Date();
      const activities: SyncActivity[] = [
        {
          id: '1',
          type: 'stock_update',
          message: 'Stock updated for Product A',
          timestamp: new Date(now.getTime() - 5 * 60000).toISOString(),
          channelType: 'eposnow',
          productName: 'Product A',
          oldValue: 25,
          newValue: 20,
        },
        {
          id: '2',
          type: 'product_sync',
          message: 'Synced 15 products to Wix',
          timestamp: new Date(now.getTime() - 15 * 60000).toISOString(),
          channelType: 'wix',
        },
        {
          id: '3',
          type: 'alert',
          message: 'Low stock warning: SKU-001',
          timestamp: new Date(now.getTime() - 30 * 60000).toISOString(),
          productName: 'SKU-001',
        },
        {
          id: '4',
          type: 'channel_connect',
          message: 'Deliveroo channel connected',
          timestamp: new Date(now.getTime() - 60 * 60000).toISOString(),
          channelType: 'deliveroo',
        },
        {
          id: '5',
          type: 'stock_update',
          message: 'Stock updated for Product B',
          timestamp: new Date(now.getTime() - 90 * 60000).toISOString(),
          channelType: 'eposnow',
          productName: 'Product B',
          oldValue: 100,
          newValue: 95,
        },
      ];
      return activities.slice(0, limit);
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });
};

// ============ Products Hooks ============

export const useProducts = (filters?: { channel?: string; search?: string }) => {
  return useQuery<Product[]>({
    queryKey: ['products', filters],
    queryFn: async () => {
      // Mock data for development
      const products: Product[] = [
        {
          id: '1',
          sku: 'SKU-001',
          name: 'Organic Honey',
          stock: 45,
          bufferStock: 10,
          price: 12.99,
          channels: [
            { channelId: '1', channelType: 'eposnow', externalId: 'EP-001', stock: 45, price: 12.99, lastSync: new Date().toISOString(), status: 'synced' },
            { channelId: '2', channelType: 'wix', externalId: 'WX-001', stock: 45, price: 12.99, lastSync: new Date().toISOString(), status: 'synced' },
          ],
          lastSync: new Date().toISOString(),
        },
        {
          id: '2',
          sku: 'SKU-002',
          name: 'Raw Almonds 500g',
          stock: 8,
          bufferStock: 15,
          price: 8.50,
          channels: [
            { channelId: '1', channelType: 'eposnow', externalId: 'EP-002', stock: 8, price: 8.50, lastSync: new Date().toISOString(), status: 'synced' },
            { channelId: '3', channelType: 'deliveroo', externalId: 'DL-002', stock: 8, price: 9.00, lastSync: new Date().toISOString(), status: 'synced' },
          ],
          lastSync: new Date().toISOString(),
        },
        {
          id: '3',
          sku: 'SKU-003',
          name: 'Sourdough Bread',
          stock: 22,
          bufferStock: 5,
          price: 4.99,
          channels: [
            { channelId: '1', channelType: 'eposnow', externalId: 'EP-003', stock: 22, price: 4.99, lastSync: new Date().toISOString(), status: 'synced' },
            { channelId: '2', channelType: 'wix', externalId: 'WX-003', stock: 22, price: 4.99, lastSync: new Date().toISOString(), status: 'pending' },
            { channelId: '3', channelType: 'deliveroo', externalId: 'DL-003', stock: 22, price: 5.49, lastSync: new Date().toISOString(), status: 'synced' },
          ],
          lastSync: new Date().toISOString(),
        },
        {
          id: '4',
          sku: 'SKU-004',
          name: 'Olive Oil Extra Virgin 1L',
          stock: 67,
          bufferStock: 20,
          price: 15.99,
          channels: [
            { channelId: '1', channelType: 'eposnow', externalId: 'EP-004', stock: 67, price: 15.99, lastSync: new Date().toISOString(), status: 'synced' },
          ],
          lastSync: new Date().toISOString(),
        },
        {
          id: '5',
          sku: 'SKU-005',
          name: 'Artisan Cheese Selection',
          stock: 3,
          bufferStock: 10,
          price: 24.99,
          channels: [
            { channelId: '1', channelType: 'eposnow', externalId: 'EP-005', stock: 3, price: 24.99, lastSync: new Date().toISOString(), status: 'error' },
            { channelId: '2', channelType: 'wix', externalId: 'WX-005', stock: 3, price: 24.99, lastSync: new Date().toISOString(), status: 'synced' },
          ],
          lastSync: new Date().toISOString(),
        },
      ];

      // Apply filters
      let filtered = products;
      if (filters?.channel) {
        filtered = filtered.filter((p) =>
          p.channels.some((c) => c.channelType === filters.channel)
        );
      }
      if (filters?.search) {
        const search = filters.search.toLowerCase();
        filtered = filtered.filter(
          (p) =>
            p.name.toLowerCase().includes(search) ||
            p.sku.toLowerCase().includes(search)
        );
      }

      return filtered;
    },
  });
};

export const useUpdateProductStock = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ productId, stock }: { productId: string; stock: number }) => {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { productId, stock };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
};

// ============ Channels Hooks ============

export const useChannels = () => {
  return useQuery<Channel[]>({
    queryKey: ['channels'],
    queryFn: async () => {
      // Mock data for development
      return [
        {
          id: '1',
          type: 'eposnow',
          name: 'Eposnow POS',
          status: 'connected',
          lastSync: new Date().toISOString(),
          productCount: 156,
        },
        {
          id: '2',
          type: 'wix',
          name: 'Wix Store',
          status: 'syncing',
          lastSync: new Date(Date.now() - 5 * 60000).toISOString(),
          productCount: 142,
        },
        {
          id: '3',
          type: 'deliveroo',
          name: 'Deliveroo Menu',
          status: 'connected',
          lastSync: new Date(Date.now() - 15 * 60000).toISOString(),
          productCount: 45,
        },
      ];
    },
  });
};

export const useConnectChannel = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (channelType: string) => {
      // Simulate OAuth flow
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return { channelType, success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
  });
};

export const useDisconnectChannel = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (channelId: string) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { channelId, success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
  });
};

export const useSyncChannel = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (channelId: string) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return { channelId, success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
      queryClient.invalidateQueries({ queryKey: ['sync', 'activity'] });
    },
  });
};

export { api };
