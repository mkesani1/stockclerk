import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';

/**
 * Lightweight Wix Dashboard iFrame Bundle
 * Minimal dependencies, fast load time (<400ms)
 * Shows key metrics: sync status, product count, last sync, alerts
 */

// ============================================================================
// Types
// ============================================================================

interface DashboardStats {
  totalProducts: number;
  totalChannels: number;
  activeAlerts: number;
  recentSyncs: number;
  stockHealth: {
    healthy: number;
    low: number;
    outOfStock: number;
  };
  channelStatus: {
    connected: number;
    disconnected: number;
    syncing: number;
  };
  syncActivity: {
    last24h: number;
    successful: number;
    failed: number;
  };
}

interface WixParams {
  instanceToken?: string;
  instanceId?: string;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get URL search parameters
 */
function getWixParams(): WixParams {
  const params = new URLSearchParams(window.location.search);
  return {
    instanceToken: params.get('instanceToken') || undefined,
    instanceId: params.get('instanceId') || undefined,
  };
}

/**
 * Get API base URL
 */
function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_URL || '/api';
}

/**
 * Get token from storage or URL
 */
function getAuthToken(): string | null {
  // First try URL params (for Wix iFrame)
  const params = getWixParams();
  if (params.instanceToken) {
    return params.instanceToken;
  }

  // Fall back to localStorage
  return localStorage.getItem('stocksync_token');
}

/**
 * Format timestamp to relative time
 */
function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return date.toLocaleDateString();
  } catch {
    return 'unknown';
  }
}

/**
 * Fetch dashboard stats from API
 */
async function fetchDashboardStats(token: string): Promise<DashboardStats> {
  const apiUrl = getApiBaseUrl();
  const response = await fetch(`${apiUrl}/dashboard/stats`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch dashboard stats: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data || data;
}

// ============================================================================
// Components
// ============================================================================

/**
 * Status indicator circle
 */
function StatusIndicator({ status }: { status: 'healthy' | 'warning' | 'error' }) {
  const colors: Record<string, string> = {
    healthy: '#4caf50',
    warning: '#ffc107',
    error: '#f44336',
  };

  return (
    <div
      style={{
        width: '12px',
        height: '12px',
        borderRadius: '50%',
        backgroundColor: colors[status],
        display: 'inline-block',
        marginRight: '8px',
      }}
    />
  );
}

/**
 * Metric card component
 */
function MetricCard({
  label,
  value,
  unit,
  status,
}: {
  label: string;
  value: string | number;
  unit?: string;
  status?: 'healthy' | 'warning' | 'error';
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: '150px',
        padding: '12px',
        backgroundColor: '#ffffff',
        border: '1px solid #e0e0e0',
        borderRadius: '6px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '12px', color: '#999', marginBottom: '6px' }}>
        {status && <StatusIndicator status={status} />}
        {label}
      </div>
      <div
        style={{
          fontSize: '24px',
          fontWeight: 'bold',
          color: '#1a1a2e',
          letterSpacing: '-0.5px',
        }}
      >
        {value}
        {unit && <span style={{ fontSize: '14px', marginLeft: '4px' }}>{unit}</span>}
      </div>
    </div>
  );
}

/**
 * Main WixDashboard component
 */
function WixDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');

  useEffect(() => {
    async function loadStats() {
      try {
        const token = getAuthToken();
        if (!token) {
          setError('Authentication required. Please log in to StockClerk.');
          setLoading(false);
          return;
        }

        const data = await fetchDashboardStats(token);
        setStats(data);

        // Update last sync time
        setLastSyncTime(new Date().toISOString());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    }

    loadStats();

    // Refresh every 30 seconds
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              border: '3px solid #e0e0e0',
              borderTopColor: '#C9B8A8',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 12px',
            }}
          />
          <div style={{ color: '#666', fontSize: '13px' }}>Loading dashboard...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '20px',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            maxWidth: '300px',
            backgroundColor: '#fff3e0',
            padding: '16px',
            borderRadius: '6px',
            border: '1px solid #ffe0b2',
          }}
        >
          <div style={{ color: '#e65100', fontWeight: 'bold', marginBottom: '8px' }}>Error</div>
          <div style={{ color: '#bf360c', fontSize: '13px' }}>{error}</div>
        </div>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  // Determine sync status
  const syncStatus =
    stats.channelStatus.syncing > 0
      ? 'warning'
      : stats.channelStatus.disconnected > 0
        ? 'error'
        : 'healthy';

  // Determine stock health status
  const stockStatus = stats.stockHealth.outOfStock > 0 ? 'error' : stats.stockHealth.low > 0 ? 'warning' : 'healthy';

  return (
    <div style={{ padding: '16px', height: '100%', backgroundColor: '#f8f8f8', overflow: 'auto' }}>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: '16px' }}>
        <h1
          style={{
            fontSize: '18px',
            fontWeight: 'bold',
            color: '#1a1a2e',
            margin: '0 0 8px 0',
          }}
        >
          StockClerk Dashboard
        </h1>
        <p style={{ fontSize: '12px', color: '#999', margin: 0 }}>
          Last updated: {formatRelativeTime(lastSyncTime)}
        </p>
      </div>

      {/* Main Metrics Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        <MetricCard
          label="Sync Status"
          value={stats.channelStatus.connected}
          unit={`/ ${stats.totalChannels}`}
          status={syncStatus}
        />
        <MetricCard label="Products Synced" value={stats.totalProducts} status={stockStatus} />
        <MetricCard
          label="Stock Health"
          value={stats.stockHealth.healthy}
          unit="healthy"
          status={stockStatus}
        />
        <MetricCard
          label="Active Alerts"
          value={stats.activeAlerts}
          status={stats.activeAlerts > 0 ? 'warning' : 'healthy'}
        />
      </div>

      {/* Stats breakdown */}
      <div
        style={{
          padding: '12px',
          backgroundColor: '#ffffff',
          border: '1px solid #e0e0e0',
          borderRadius: '6px',
          marginBottom: '16px',
          fontSize: '13px',
        }}
      >
        <div style={{ fontWeight: 'bold', color: '#1a1a2e', marginBottom: '8px' }}>Sync Details</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div>
            <span style={{ color: '#999' }}>Last 24h:</span>
            <span style={{ marginLeft: '8px', fontWeight: 'bold' }}>{stats.syncActivity.last24h}</span>
          </div>
          <div>
            <span style={{ color: '#999' }}>Successful:</span>
            <span style={{ marginLeft: '8px', fontWeight: 'bold', color: '#4caf50' }}>
              {stats.syncActivity.successful}
            </span>
          </div>
          <div>
            <span style={{ color: '#999' }}>Failed:</span>
            <span
              style={{
                marginLeft: '8px',
                fontWeight: 'bold',
                color: stats.syncActivity.failed > 0 ? '#f44336' : '#4caf50',
              }}
            >
              {stats.syncActivity.failed}
            </span>
          </div>
          <div>
            <span style={{ color: '#999' }}>Channels:</span>
            <span style={{ marginLeft: '8px', fontWeight: 'bold' }}>
              {stats.channelStatus.connected} connected
            </span>
          </div>
        </div>
      </div>

      {/* Stock health breakdown */}
      {(stats.stockHealth.low > 0 || stats.stockHealth.outOfStock > 0) && (
        <div
          style={{
            padding: '12px',
            backgroundColor: '#fff3e0',
            border: '1px solid #ffe0b2',
            borderRadius: '6px',
            marginBottom: '16px',
            fontSize: '13px',
          }}
        >
          <div style={{ fontWeight: 'bold', color: '#e65100', marginBottom: '8px' }}>Attention Needed</div>
          <div style={{ display: 'flex', gap: '16px' }}>
            {stats.stockHealth.low > 0 && (
              <div>
                <span style={{ color: '#bf360c' }}>Low Stock:</span>
                <span style={{ marginLeft: '8px', fontWeight: 'bold' }}>{stats.stockHealth.low}</span>
              </div>
            )}
            {stats.stockHealth.outOfStock > 0 && (
              <div>
                <span style={{ color: '#bf360c' }}>Out of Stock:</span>
                <span style={{ marginLeft: '8px', fontWeight: 'bold' }}>{stats.stockHealth.outOfStock}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Open Full Dashboard button */}
      <div style={{ marginTop: '16px' }}>
        <a
          href="/dashboard"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block',
            width: '100%',
            padding: '12px 16px',
            backgroundColor: '#1a1a2e',
            color: '#C9B8A8',
            textDecoration: 'none',
            borderRadius: '6px',
            textAlign: 'center',
            fontWeight: '500',
            fontSize: '13px',
            border: '1px solid #C9B8A8',
            transition: 'all 0.2s ease',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#C9B8A8';
            e.currentTarget.style.color = '#1a1a2e';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#1a1a2e';
            e.currentTarget.style.color = '#C9B8A8';
          }}
        >
          Open Full Dashboard →
        </a>
      </div>
    </div>
  );
}

// ============================================================================
// Render
// ============================================================================

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <WixDashboard />
  </React.StrictMode>
);
