import React, { useState, useEffect } from 'react';
import { adminApi } from '../../api/client';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { PageHeader, PageWrapper } from '../../components/layout/Layout';
import { StatusBadge } from '../../components/ui/Badge';

interface HealthData {
  status: string;
  timestamp: string;
  database?: {
    connected: boolean;
    responseTime?: number;
  };
  redis?: {
    connected: boolean;
    responseTime?: number;
  };
  queue?: {
    status: string;
    pendingJobs?: number;
  };
  [key: string]: any;
}

export default function AdminSystemHealth(): React.ReactElement {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        setLoading(true);
        const data = await adminApi.getSystemHealth();
        setHealth(data);
        setLastRefresh(new Date());
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load system health');
      } finally {
        setLoading(false);
      }
    };

    const interval = setInterval(fetchHealth, 60000); // Auto-refresh every 60 seconds
    fetchHealth();

    return () => clearInterval(interval);
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

  const getHealthStatus = (isHealthy: boolean | undefined) => {
    if (isHealthy === undefined) return 'offline';
    return isHealthy ? 'online' : 'error';
  };

  return (
    <PageWrapper>
      <PageHeader
        title="System Health"
        subtitle="Monitor system status (auto-refreshes every 60 seconds)"
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
          <p className="text-text-muted">Loading...</p>
        </div>
      ) : health ? (
        <div className="space-y-6">
          {/* Overall Status */}
          <Card variant="elevated">
            <CardHeader>
              <CardTitle>Overall Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-text-muted font-medium">System Status</p>
                <StatusBadge status={health.status === 'healthy' ? 'online' : 'error'}>
                  {health.status || 'Unknown'}
                </StatusBadge>
              </div>
              {health.timestamp && (
                <div className="flex items-center justify-between pt-2 border-t border-bronze-200">
                  <p className="text-sm text-text-muted">Last Updated</p>
                  <p className="text-sm text-text font-mono">{formatDate(health.timestamp)}</p>
                </div>
              )}
              {lastRefresh && (
                <div className="flex items-center justify-between pt-2 border-t border-bronze-200">
                  <p className="text-sm text-text-muted">Check Time</p>
                  <p className="text-sm text-text font-mono">{formatDate(lastRefresh.toISOString())}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Database Status */}
          {health.database && (
            <Card variant="elevated">
              <CardHeader>
                <CardTitle>Database</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-text-muted">Connection</p>
                  <StatusBadge status={health.database.connected ? 'online' : 'offline'} />
                </div>
                {health.database.responseTime !== undefined && (
                  <div className="flex items-center justify-between pt-2 border-t border-bronze-200">
                    <p className="text-sm text-text-muted">Response Time</p>
                    <p className="text-sm text-text font-mono">{health.database.responseTime}ms</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Redis Status */}
          {health.redis && (
            <Card variant="elevated">
              <CardHeader>
                <CardTitle>Redis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-text-muted">Connection</p>
                  <StatusBadge status={health.redis.connected ? 'online' : 'offline'} />
                </div>
                {health.redis.responseTime !== undefined && (
                  <div className="flex items-center justify-between pt-2 border-t border-bronze-200">
                    <p className="text-sm text-text-muted">Response Time</p>
                    <p className="text-sm text-text font-mono">{health.redis.responseTime}ms</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Queue Status */}
          {health.queue && (
            <Card variant="elevated">
              <CardHeader>
                <CardTitle>Queue System</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-text-muted">Status</p>
                  <p className="text-sm font-medium text-text">{health.queue.status || 'Unknown'}</p>
                </div>
                {health.queue.pendingJobs !== undefined && (
                  <div className="flex items-center justify-between pt-2 border-t border-bronze-200">
                    <p className="text-sm text-text-muted">Pending Jobs</p>
                    <p className="text-sm text-text font-mono">{health.queue.pendingJobs}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Additional Service Info */}
          {Object.entries(health).map(([key, value]) => {
            if (
              ['status', 'timestamp', 'database', 'redis', 'queue'].includes(key) ||
              typeof value !== 'object' ||
              value === null
            ) {
              return null;
            }

            return (
              <Card key={key} variant="elevated">
                <CardHeader>
                  <CardTitle className="capitalize">{key.replace(/_/g, ' ')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {typeof value === 'object' &&
                      Object.entries(value).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between text-sm">
                          <p className="text-text-muted capitalize">{k.replace(/_/g, ' ')}</p>
                          <p className="text-text font-mono">
                            {typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}
                          </p>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center justify-center py-12">
          <p className="text-text-muted">No health data available</p>
        </div>
      )}
    </PageWrapper>
  );
}
