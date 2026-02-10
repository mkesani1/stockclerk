import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../api/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { cn } from '../../lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  description?: string;
  accentColor?: 'primary' | 'success' | 'warning' | 'error';
  icon?: React.ReactNode;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, description, accentColor = 'primary', icon }) => {
  const accentClasses = {
    primary: 'border-l-primary',
    success: 'border-l-success',
    warning: 'border-l-warning',
    error: 'border-l-error',
  };

  return (
    <Card variant="elevated" className={cn('border-l-4', accentClasses[accentColor])}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm text-text-muted font-medium mb-2">{label}</p>
            <p className="text-3xl font-bold text-text">{value}</p>
            {description && <p className="text-xs text-text-muted mt-2">{description}</p>}
          </div>
          {icon && (
            <div className={cn(
              'w-10 h-10 rounded-lg flex items-center justify-center text-lg',
              accentColor === 'primary' && 'bg-primary/10 text-primary',
              accentColor === 'success' && 'bg-success/10 text-success',
              accentColor === 'warning' && 'bg-warning/10 text-warning',
              accentColor === 'error' && 'bg-error/10 text-error',
            )}>
              {icon}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

interface QuickLinkProps {
  label: string;
  href: string;
  icon: React.ReactNode;
  description?: string;
}

const QuickLink: React.FC<QuickLinkProps> = ({ label, href, icon, description }) => {
  return (
    <Link to={href}>
      <Card variant="elevated" className="cursor-pointer hover:shadow-lg transition-all duration-200 h-full">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-lg flex-shrink-0">
              {icon}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold text-text">{label}</h4>
              {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
            </div>
            <svg className="w-4 h-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </CardContent>
      </Card>
    </Link>
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
    <div className="p-6">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text">System Overview</h1>
        <p className="text-text-muted mt-2">Global platform statistics and management</p>
      </div>

      {/* Error Alert */}
      {error && (
        <Card variant="outlined" className="border-error mb-6 bg-error/5">
          <CardContent className="py-3 px-5">
            <p className="text-sm text-error font-medium">Error loading dashboard</p>
            <p className="text-xs text-error/80 mt-1">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <Spinner size="lg" className="text-primary mb-4" />
          <p className="text-text-muted">Loading dashboard...</p>
        </div>
      )}

      {/* Stats Grid */}
      {!loading && stats && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <StatCard
              label="Total Tenants"
              value={stats.tenantCount ?? 0}
              accentColor="primary"
              icon="👥"
            />
            <StatCard
              label="Total Users"
              value={stats.userCount ?? 0}
              accentColor="primary"
              icon="👤"
            />
            <StatCard
              label="Total Products"
              value={stats.productCount ?? 0}
              accentColor="success"
              icon="📦"
            />
            <StatCard
              label="Active Channels"
              value={stats.channelCount ?? 0}
              accentColor="success"
              icon="🔗"
            />
            <StatCard
              label="Sync Events (24h)"
              value={stats.syncEventsLast24h ?? 0}
              description="Last 24 hours"
              accentColor="primary"
              icon="↔️"
            />
            <StatCard
              label="Failed Syncs (24h)"
              value={stats.failedSyncEventsLast24h ?? 0}
              description="Last 24 hours"
              accentColor={stats.failedSyncEventsLast24h > 0 ? 'error' : 'success'}
              icon="⚠️"
            />
            <StatCard
              label="Unread Alerts"
              value={stats.unreadAlerts ?? 0}
              accentColor={stats.unreadAlerts > 0 ? 'warning' : 'success'}
              icon="🔔"
            />
          </div>

          {/* Quick Links Section */}
          <div>
            <h2 className="text-lg font-semibold text-text mb-4">Quick Actions</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <QuickLink
                label="View All Tenants"
                href="/admin/tenants"
                icon="🏢"
                description="Manage tenant accounts"
              />
              <QuickLink
                label="Sync Monitor"
                href="/admin/sync-monitor"
                icon="📊"
                description="Monitor sync operations"
              />
              <QuickLink
                label="System Health"
                href="/admin/system-health"
                icon="❤️"
                description="Check system status"
              />
              <QuickLink
                label="Enterprise Enquiries"
                href="/admin/enquiries"
                icon="📧"
                description="Review enquiries"
              />
            </div>
          </div>
        </>
      )}

      {/* No Data State */}
      {!loading && !stats && !error && (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-16 h-16 rounded-full bg-bronze-100 flex items-center justify-center mb-4 text-2xl">
            📊
          </div>
          <h3 className="text-lg font-medium text-text">No data available</h3>
          <p className="text-text-muted mt-1">Unable to retrieve dashboard data at this time</p>
        </div>
      )}
    </div>
  );
}
