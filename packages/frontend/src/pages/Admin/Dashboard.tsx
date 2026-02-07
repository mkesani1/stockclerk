import React, { useState, useEffect } from 'react';
import { adminApi } from '../../api/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { PageHeader, PageWrapper } from '../../components/layout/Layout';
import { cn } from '../../lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  description?: string;
  accentColor?: 'primary' | 'success' | 'warning' | 'error';
}

const StatCard: React.FC<StatCardProps> = ({ label, value, description, accentColor = 'primary' }) => {
  const accentClasses = {
    primary: 'border-l-primary',
    success: 'border-l-success',
    warning: 'border-l-warning',
    error: 'border-l-error',
  };

  return (
    <Card variant="elevated" className={cn('border-l-4', accentClasses[accentColor])}>
      <CardContent>
        <p className="text-sm text-text-muted font-medium mb-2">{label}</p>
        <p className="text-3xl font-bold text-text">{value}</p>
        {description && <p className="text-xs text-text-muted mt-2">{description}</p>}
      </CardContent>
    </Card>
  );
};

export default function AdminDashboard(): React.ReactElement {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        const data = await adminApi.getStats();
        setStats(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load stats');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  return (
    <PageWrapper>
      <PageHeader
        title="Admin Dashboard"
        subtitle="System overview and key metrics"
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
      ) : stats ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            label="Total Tenants"
            value={stats.totalTenants ?? 0}
            accentColor="primary"
          />
          <StatCard
            label="Total Users"
            value={stats.totalUsers ?? 0}
            accentColor="primary"
          />
          <StatCard
            label="Total Products"
            value={stats.totalProducts ?? 0}
            accentColor="success"
          />
          <StatCard
            label="Active Channels"
            value={stats.activeChannels ?? 0}
            accentColor="success"
          />
          <StatCard
            label="Syncs (24h)"
            value={stats.syncs24h ?? 0}
            description="Last 24 hours"
            accentColor="primary"
          />
          <StatCard
            label="Failed Syncs"
            value={stats.failedSyncs ?? 0}
            description="Last 24 hours"
            accentColor={stats.failedSyncs > 0 ? 'error' : 'success'}
          />
          <StatCard
            label="Unread Alerts"
            value={stats.unreadAlerts ?? 0}
            accentColor={stats.unreadAlerts > 0 ? 'warning' : 'success'}
          />
          {stats.activeConnections !== undefined && (
            <StatCard
              label="Active Connections"
              value={stats.activeConnections}
              accentColor="success"
            />
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center py-12">
          <p className="text-text-muted">No data available</p>
        </div>
      )}
    </PageWrapper>
  );
}
