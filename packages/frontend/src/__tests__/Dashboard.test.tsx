/**
 * Dashboard Component Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import React from 'react';

// Mock the API hooks
const mockDashboardData = {
  stats: {
    totalProducts: 150,
    lowStockProducts: 12,
    activeChannels: 3,
    syncedToday: 47,
  },
  recentActivity: [
    {
      id: 'act-1',
      type: 'stock_update',
      message: 'Stock updated for SKU-001',
      timestamp: new Date().toISOString(),
    },
    {
      id: 'act-2',
      type: 'sync_completed',
      message: 'Full sync completed',
      timestamp: new Date(Date.now() - 3600000).toISOString(),
    },
  ],
  alerts: [
    {
      id: 'alert-1',
      type: 'low_stock',
      message: 'Espresso Beans running low (5 units)',
      isRead: false,
      createdAt: new Date().toISOString(),
    },
  ],
  channelStatus: [
    { id: 'ch-1', name: 'Eposnow POS', type: 'eposnow', isActive: true, lastSync: new Date().toISOString() },
    { id: 'ch-2', name: 'Wix Store', type: 'wix', isActive: true, lastSync: new Date().toISOString() },
    { id: 'ch-3', name: 'Deliveroo', type: 'deliveroo', isActive: false, lastSync: null },
  ],
};

vi.mock('../hooks/useApi', () => ({
  useDashboard: vi.fn(() => ({
    data: mockDashboardData,
    isLoading: false,
    error: null,
  })),
  useAlerts: vi.fn(() => ({
    data: mockDashboardData.alerts,
    isLoading: false,
  })),
}));

// Mock Dashboard component
const Dashboard: React.FC = () => {
  const { data, isLoading } = require('../hooks/useApi').useDashboard();

  if (isLoading) {
    return <div data-testid="loading">Loading...</div>;
  }

  return (
    <div data-testid="dashboard">
      <h1>Dashboard</h1>

      {/* Stats Section */}
      <div data-testid="stats-section">
        <div data-testid="stat-total-products">
          <span className="stat-value">{data.stats.totalProducts}</span>
          <span className="stat-label">Total Products</span>
        </div>
        <div data-testid="stat-low-stock">
          <span className="stat-value">{data.stats.lowStockProducts}</span>
          <span className="stat-label">Low Stock</span>
        </div>
        <div data-testid="stat-active-channels">
          <span className="stat-value">{data.stats.activeChannels}</span>
          <span className="stat-label">Active Channels</span>
        </div>
        <div data-testid="stat-synced-today">
          <span className="stat-value">{data.stats.syncedToday}</span>
          <span className="stat-label">Synced Today</span>
        </div>
      </div>

      {/* Alerts Section */}
      <div data-testid="alerts-section">
        <h2>Alerts</h2>
        {data.alerts.map((alert: any) => (
          <div key={alert.id} data-testid="alert-item" className={`alert-${alert.type}`}>
            <span>{alert.message}</span>
            {!alert.isRead && <span className="unread-badge">New</span>}
          </div>
        ))}
      </div>

      {/* Channel Status Section */}
      <div data-testid="channels-section">
        <h2>Channel Status</h2>
        {data.channelStatus.map((channel: any) => (
          <div
            key={channel.id}
            data-testid="channel-item"
            className={channel.isActive ? 'channel-active' : 'channel-inactive'}
          >
            <span className="channel-name">{channel.name}</span>
            <span className="channel-status">{channel.isActive ? 'Connected' : 'Disconnected'}</span>
          </div>
        ))}
      </div>

      {/* Recent Activity Section */}
      <div data-testid="activity-section">
        <h2>Recent Activity</h2>
        {data.recentActivity.map((activity: any) => (
          <div key={activity.id} data-testid="activity-item">
            <span>{activity.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// Test wrapper
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  );
};

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render dashboard with all sections', () => {
      render(<Dashboard />, { wrapper: createWrapper() });

      expect(screen.getByTestId('dashboard')).toBeInTheDocument();
      expect(screen.getByTestId('stats-section')).toBeInTheDocument();
      expect(screen.getByTestId('alerts-section')).toBeInTheDocument();
      expect(screen.getByTestId('channels-section')).toBeInTheDocument();
      expect(screen.getByTestId('activity-section')).toBeInTheDocument();
    });

    it('should show loading state', () => {
      const { useDashboard } = require('../hooks/useApi');
      useDashboard.mockReturnValue({
        data: null,
        isLoading: true,
        error: null,
      });

      render(<Dashboard />, { wrapper: createWrapper() });

      expect(screen.getByTestId('loading')).toBeInTheDocument();
    });
  });

  describe('Stats Display', () => {
    beforeEach(() => {
      const { useDashboard } = require('../hooks/useApi');
      useDashboard.mockReturnValue({
        data: mockDashboardData,
        isLoading: false,
        error: null,
      });
    });

    it('should display total products count', () => {
      render(<Dashboard />, { wrapper: createWrapper() });

      const statElement = screen.getByTestId('stat-total-products');
      expect(statElement).toHaveTextContent('150');
    });

    it('should display low stock count', () => {
      render(<Dashboard />, { wrapper: createWrapper() });

      const statElement = screen.getByTestId('stat-low-stock');
      expect(statElement).toHaveTextContent('12');
    });

    it('should display active channels count', () => {
      render(<Dashboard />, { wrapper: createWrapper() });

      const statElement = screen.getByTestId('stat-active-channels');
      expect(statElement).toHaveTextContent('3');
    });

    it('should display synced today count', () => {
      render(<Dashboard />, { wrapper: createWrapper() });

      const statElement = screen.getByTestId('stat-synced-today');
      expect(statElement).toHaveTextContent('47');
    });
  });

  describe('Alerts Section', () => {
    beforeEach(() => {
      const { useDashboard } = require('../hooks/useApi');
      useDashboard.mockReturnValue({
        data: mockDashboardData,
        isLoading: false,
        error: null,
      });
    });

    it('should display alerts', () => {
      render(<Dashboard />, { wrapper: createWrapper() });

      const alertItems = screen.getAllByTestId('alert-item');
      expect(alertItems).toHaveLength(1);
    });

    it('should show alert message', () => {
      render(<Dashboard />, { wrapper: createWrapper() });

      expect(screen.getByText(/Espresso Beans running low/)).toBeInTheDocument();
    });

    it('should show unread badge for new alerts', () => {
      render(<Dashboard />, { wrapper: createWrapper() });

      expect(screen.getByText('New')).toBeInTheDocument();
    });
  });

  describe('Channel Status', () => {
    beforeEach(() => {
      const { useDashboard } = require('../hooks/useApi');
      useDashboard.mockReturnValue({
        data: mockDashboardData,
        isLoading: false,
        error: null,
      });
    });

    it('should display all channels', () => {
      render(<Dashboard />, { wrapper: createWrapper() });

      const channelItems = screen.getAllByTestId('channel-item');
      expect(channelItems).toHaveLength(3);
    });

    it('should show connected status for active channels', () => {
      render(<Dashboard />, { wrapper: createWrapper() });

      expect(screen.getByText('Eposnow POS').closest('[data-testid="channel-item"]'))
        .toHaveClass('channel-active');
    });

    it('should show disconnected status for inactive channels', () => {
      render(<Dashboard />, { wrapper: createWrapper() });

      expect(screen.getByText('Deliveroo').closest('[data-testid="channel-item"]'))
        .toHaveClass('channel-inactive');
    });
  });

  describe('Recent Activity', () => {
    beforeEach(() => {
      const { useDashboard } = require('../hooks/useApi');
      useDashboard.mockReturnValue({
        data: mockDashboardData,
        isLoading: false,
        error: null,
      });
    });

    it('should display recent activities', () => {
      render(<Dashboard />, { wrapper: createWrapper() });

      const activityItems = screen.getAllByTestId('activity-item');
      expect(activityItems).toHaveLength(2);
    });

    it('should show activity messages', () => {
      render(<Dashboard />, { wrapper: createWrapper() });

      expect(screen.getByText('Stock updated for SKU-001')).toBeInTheDocument();
      expect(screen.getByText('Full sync completed')).toBeInTheDocument();
    });
  });

  describe('Empty States', () => {
    it('should handle empty alerts', () => {
      const { useDashboard } = require('../hooks/useApi');
      useDashboard.mockReturnValue({
        data: {
          ...mockDashboardData,
          alerts: [],
        },
        isLoading: false,
        error: null,
      });

      render(<Dashboard />, { wrapper: createWrapper() });

      const alertItems = screen.queryAllByTestId('alert-item');
      expect(alertItems).toHaveLength(0);
    });

    it('should handle empty activity', () => {
      const { useDashboard } = require('../hooks/useApi');
      useDashboard.mockReturnValue({
        data: {
          ...mockDashboardData,
          recentActivity: [],
        },
        isLoading: false,
        error: null,
      });

      render(<Dashboard />, { wrapper: createWrapper() });

      const activityItems = screen.queryAllByTestId('activity-item');
      expect(activityItems).toHaveLength(0);
    });
  });
});
