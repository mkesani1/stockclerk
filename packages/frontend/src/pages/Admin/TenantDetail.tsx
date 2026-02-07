import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { adminApi } from '../../api/client';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { PageHeader, PageWrapper } from '../../components/layout/Layout';
import { Button } from '../../components/ui/Button';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { cn } from '../../lib/utils';

interface Channel {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

interface SyncEvent {
  id: string;
  timestamp: string;
  type: string;
  status: 'completed' | 'failed' | 'pending' | 'processing';
  error?: string;
}

interface TenantData {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  channels?: Channel[];
  recentSyncEvents?: SyncEvent[];
  alerts?: any[];
}

export default function AdminTenantDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    const fetchTenant = async () => {
      try {
        setLoading(true);
        const data = await adminApi.getTenant(id);
        setTenant(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tenant');
      } finally {
        setLoading(false);
      }
    };

    fetchTenant();
  }, [id]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      case 'pending':
        return 'warning';
      case 'processing':
        return 'primary';
      default:
        return 'default';
    }
  };

  return (
    <PageWrapper>
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => navigate('/admin/tenants')}
          className="mb-4"
        >
          ← Back to Tenants
        </Button>
        <PageHeader
          title={tenant?.name || 'Loading...'}
          subtitle="Tenant details and activity"
        />
      </div>

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
      ) : tenant ? (
        <div className="space-y-6">
          {/* Tenant Info Card */}
          <Card variant="elevated">
            <CardHeader>
              <CardTitle>Tenant Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-text-muted uppercase">Tenant ID</p>
                  <p className="text-sm text-text font-mono mt-1">{tenant.id}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-text-muted uppercase">Slug</p>
                  <p className="text-sm text-text font-mono mt-1">{tenant.slug}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs font-semibold text-text-muted uppercase">Created</p>
                  <p className="text-sm text-text mt-1">{formatDate(tenant.createdAt)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Channels Card */}
          {tenant.channels && tenant.channels.length > 0 && (
            <Card variant="elevated">
              <CardHeader>
                <CardTitle>Channels</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {tenant.channels.map((channel) => (
                    <div
                      key={channel.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-bronze-200 bg-background-alt"
                    >
                      <div>
                        <p className="text-sm font-medium text-text">{channel.name}</p>
                        <p className="text-xs text-text-muted">{channel.type}</p>
                      </div>
                      <StatusBadge status={channel.isActive ? 'online' : 'offline'} />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent Sync Events Card */}
          {tenant.recentSyncEvents && tenant.recentSyncEvents.length > 0 && (
            <Card variant="elevated">
              <CardHeader>
                <CardTitle>Recent Sync Events</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-bronze-200">
                        <th className="px-4 py-2 text-left text-xs font-semibold text-text-muted">Time</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-text-muted">Type</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-text-muted">Status</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-text-muted">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tenant.recentSyncEvents.map((event, idx) => (
                        <tr
                          key={event.id}
                          className={cn(
                            'border-b border-bronze-200',
                            idx === tenant.recentSyncEvents!.length - 1 && 'border-b-0'
                          )}
                        >
                          <td className="px-4 py-3 text-text-muted">{formatDate(event.timestamp)}</td>
                          <td className="px-4 py-3 text-text font-medium">{event.type}</td>
                          <td className="px-4 py-3">
                            <Badge variant={getStatusBadgeVariant(event.status)} size="sm">
                              {event.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-text-muted">
                            {event.error ? (
                              <span className="text-error text-xs">{event.error}</span>
                            ) : (
                              <span className="text-success">Success</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Alerts Card */}
          {tenant.alerts && tenant.alerts.length > 0 && (
            <Card variant="elevated">
              <CardHeader>
                <CardTitle>Recent Alerts</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {tenant.alerts.map((alert, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg border border-bronze-200 bg-background-alt"
                    >
                      <p className="text-sm font-medium text-text">{alert.message || alert.title}</p>
                      {alert.createdAt && (
                        <p className="text-xs text-text-muted mt-1">{formatDate(alert.createdAt)}</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center py-12">
          <p className="text-text-muted">No tenant found</p>
        </div>
      )}
    </PageWrapper>
  );
}
