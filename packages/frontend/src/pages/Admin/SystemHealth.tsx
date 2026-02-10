import React, { useState, useEffect } from 'react';
import { adminApi } from '../../api/client';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { PageHeader, PageWrapper } from '../../components/layout/Layout';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { cn } from '../../lib/utils';

interface SystemHealth {
  db: boolean;
  timestamp: string;
}

interface SystemStats {
  tenantCount: number;
  userCount: number;
  productCount: number;
  channelCount: number;
  syncEventsLast24h: number;
  failedSyncEventsLast24h: number;
  unreadAlerts: number;
}

interface StatusIconProps {
  isHealthy: boolean;
}

const StatusIcon: React.FC<StatusIconProps> = ({ isHealthy }) => {
  if (isHealthy) {
    return (
      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-success/20">
        <svg
          className="w-4 h-4 text-success"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-error/20">
      <svg
        className="w-4 h-4 text-error"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
};

export default function AdminSystemHealth(): React.ReactElement {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [healthData, statsData] = await Promise.all([
        adminApi.getSystemHealth(),
        adminApi.getStats(),
      ]);
      setHealth(healthData);
      setStats(statsData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load system health');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const calculateErrorRate = (): number => {
    if (!stats || !stats.syncEventsLast24h) return 0;
    return ((stats.failedSyncEventsLast24h / stats.syncEventsLast24h) * 100).toFixed(1) as any;
  };

  return (
    <PageWrapper>
      <PageHeader
        title="System Health"
        subtitle="Service status and metrics"
      />

      {error && (
        <Card variant="outlined" className="border-error mb-6 bg-error/5">
          <CardContent className="py-3">
            <p className="text-sm text-error">Error: {error}</p>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Service Status Section */}
          <Card variant="elevated">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Service Status</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchData}
                >
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Database Status */}
              <div className="flex items-center justify-between p-3 rounded bg-background-alt">
                <div className="flex items-center gap-3">
                  <StatusIcon isHealthy={health?.db ?? false} />
                  <div>
                    <p className="text-sm font-medium text-text">Database</p>
                    <p className="text-xs text-text-muted">
                      {health?.db ? 'Connected' : 'Disconnected'}
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    'text-xs font-semibold px-3 py-1 rounded-full',
                    health?.db
                      ? 'bg-success/20 text-success'
                      : 'bg-error/20 text-error'
                  )}
                >
                  {health?.db ? 'Healthy' : 'Down'}
                </span>
              </div>

              {/* API Server Status */}
              <div className="flex items-center justify-between p-3 rounded bg-background-alt">
                <div className="flex items-center gap-3">
                  <StatusIcon isHealthy={true} />
                  <div>
                    <p className="text-sm font-medium text-text">API Server</p>
                    <p className="text-xs text-text-muted">Running</p>
                  </div>
                </div>
                <span className="text-xs font-semibold px-3 py-1 rounded-full bg-success/20 text-success">
                  Healthy
                </span>
              </div>

              {/* Last Checked */}
              {health?.timestamp && (
                <div className="pt-3 border-t border-bronze-200">
                  <p className="text-xs text-text-muted mb-1">Last Checked</p>
                  <p className="text-sm font-mono text-text">{formatDate(health.timestamp)}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* System Metrics Section */}
          {stats && (
            <Card variant="elevated">
              <CardHeader>
                <CardTitle>System Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {/* Total Tenants */}
                  <div className="p-3 rounded bg-background-alt">
                    <p className="text-xs text-text-muted mb-1">Total Tenants</p>
                    <p className="text-2xl font-bold text-text">{stats.tenantCount}</p>
                  </div>

                  {/* Total Users */}
                  <div className="p-3 rounded bg-background-alt">
                    <p className="text-xs text-text-muted mb-1">Total Users</p>
                    <p className="text-2xl font-bold text-text">{stats.userCount}</p>
                  </div>

                  {/* Total Products */}
                  <div className="p-3 rounded bg-background-alt">
                    <p className="text-xs text-text-muted mb-1">Total Products</p>
                    <p className="text-2xl font-bold text-text">{stats.productCount}</p>
                  </div>

                  {/* Total Channels */}
                  <div className="p-3 rounded bg-background-alt">
                    <p className="text-xs text-text-muted mb-1">Total Channels</p>
                    <p className="text-2xl font-bold text-text">{stats.channelCount}</p>
                  </div>

                  {/* Sync Events (24h) */}
                  <div className="p-3 rounded bg-background-alt">
                    <p className="text-xs text-text-muted mb-1">Sync Events (24h)</p>
                    <p className="text-2xl font-bold text-text">{stats.syncEventsLast24h}</p>
                  </div>

                  {/* Error Rate */}
                  <div className="p-3 rounded bg-background-alt">
                    <p className="text-xs text-text-muted mb-1">Error Rate</p>
                    <p
                      className={cn(
                        'text-2xl font-bold',
                        calculateErrorRate() > 0 ? 'text-error' : 'text-success'
                      )}
                    >
                      {calculateErrorRate()}%
                    </p>
                  </div>
                </div>

                {/* Failed Sync Events Detail */}
                <div className="mt-4 pt-4 border-t border-bronze-200">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-text-muted">Failed Sync Events (24h)</p>
                    <p
                      className={cn(
                        'text-sm font-bold',
                        stats.failedSyncEventsLast24h > 0 ? 'text-error' : 'text-success'
                      )}
                    >
                      {stats.failedSyncEventsLast24h}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </PageWrapper>
  );
}
