import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { adminApi } from '../../api/client';
import { Button, Card, Badge, Spinner } from '../../components/ui';
import { cn } from '../../lib/utils';

interface Channel {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  lastSyncAt?: string;
}

interface SyncEvent {
  id: string;
  createdAt: string;
  eventType: string;
  status: 'completed' | 'failed' | 'pending' | 'processing';
  channelName?: string;
}

interface Alert {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  isRead: boolean;
}

interface TenantData {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  channels: Channel[];
  recentSyncEvents: SyncEvent[];
  recentAlerts: Alert[];
}

export default function TenantDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError('Tenant ID not provided');
      setLoading(false);
      return;
    }

    const fetchTenant = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await adminApi.getTenant(id);
        setTenant(data);
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
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadgeVariant = (status: string): 'success' | 'error' | 'warning' | 'primary' | 'default' => {
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

  const getAlertTypeBadgeVariant = (type: string): 'success' | 'error' | 'warning' | 'primary' | 'default' => {
    switch (type?.toLowerCase()) {
      case 'error':
        return 'error';
      case 'warning':
        return 'warning';
      case 'info':
        return 'primary';
      default:
        return 'default';
    }
  };

  if (error && !tenant) {
    return (
      <div className="space-y-6">
        <Button variant="outline" onClick={() => navigate('/admin/tenants')}>
          Back to Tenants
        </Button>
        <Card className="p-4 bg-error/10 border border-error">
          <p className="text-error font-medium">{error}</p>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Spinner />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="space-y-6">
        <Button variant="outline" onClick={() => navigate('/admin/tenants')}>
          Back to Tenants
        </Button>
        <Card className="p-12 text-center">
          <p className="text-text-muted text-lg">Tenant not found</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Button variant="outline" onClick={() => navigate('/admin/tenants')}>
        Back to Tenants
      </Button>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text">{tenant.name}</h1>
        <p className="text-text-muted mt-1">Tenant details and activity</p>
      </div>

      {/* Tenant Info Card */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-text mb-4">Information</h2>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-semibold text-text-muted uppercase">Tenant ID</p>
            <p className="text-sm text-text font-mono mt-2">{tenant.id}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-text-muted uppercase">Slug</p>
            <p className="text-sm text-text font-mono mt-2">{tenant.slug}</p>
          </div>
          <div className="col-span-2">
            <p className="text-xs font-semibold text-text-muted uppercase">Created</p>
            <p className="text-sm text-text mt-2">{formatDate(tenant.createdAt)}</p>
          </div>
        </div>
      </Card>

      {/* Channels Section */}
      {tenant.channels && tenant.channels.length > 0 && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-text mb-4">Channels</h2>
          <div className="space-y-3">
            {tenant.channels.map((channel) => (
              <div
                key={channel.id}
                className="flex items-center justify-between p-4 rounded-lg border border-bronze-200 bg-background-alt hover:border-primary transition-colors"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-text">{channel.name}</p>
                  <p className="text-xs text-text-muted mt-1">{channel.type}</p>
                  {channel.lastSyncAt && (
                    <p className="text-xs text-text-muted mt-1">Last sync: {formatDate(channel.lastSyncAt)}</p>
                  )}
                </div>
                <Badge variant={channel.isActive ? 'success' : 'warning'} size="sm">
                  {channel.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Recent Sync Events Section */}
      {tenant.recentSyncEvents && tenant.recentSyncEvents.length > 0 && (
        <Card className="p-6 overflow-hidden">
          <h2 className="text-lg font-semibold text-text mb-4">Recent Sync Events</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bronze-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text">Event Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text">Channel</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text">Created</th>
                </tr>
              </thead>
              <tbody>
                {tenant.recentSyncEvents.map((event, idx) => (
                  <tr
                    key={event.id}
                    className={cn(
                      'border-b border-bronze-200 hover:bg-background-alt transition-colors',
                      idx === tenant.recentSyncEvents.length - 1 && 'border-b-0'
                    )}
                  >
                    <td className="px-4 py-3 text-text font-medium">{event.eventType}</td>
                    <td className="px-4 py-3">
                      <Badge variant={getStatusBadgeVariant(event.status)} size="sm">
                        {event.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-text-muted">{event.channelName || '-'}</td>
                    <td className="px-4 py-3 text-text-muted text-xs">{formatDate(event.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Recent Alerts Section */}
      {tenant.recentAlerts && tenant.recentAlerts.length > 0 && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-text mb-4">Recent Alerts</h2>
          <div className="space-y-3">
            {tenant.recentAlerts.map((alert) => (
              <div
                key={alert.id}
                className={cn(
                  'p-4 rounded-lg border flex items-start justify-between',
                  alert.isRead
                    ? 'border-bronze-200 bg-background-alt opacity-75'
                    : 'border-primary bg-primary/5'
                )}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={getAlertTypeBadgeVariant(alert.type)} size="sm">
                      {alert.type}
                    </Badge>
                    {!alert.isRead && (
                      <span className="text-xs font-medium text-primary">Unread</span>
                    )}
                  </div>
                  <p className="text-sm text-text mt-2">{alert.message}</p>
                  <p className="text-xs text-text-muted mt-2">{formatDate(alert.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Empty States */}
      {(!tenant.channels || tenant.channels.length === 0) && (
        <Card className="p-8 text-center opacity-50">
          <p className="text-text-muted">No channels configured</p>
        </Card>
      )}

      {(!tenant.recentSyncEvents || tenant.recentSyncEvents.length === 0) && (
        <Card className="p-8 text-center opacity-50">
          <p className="text-text-muted">No sync events</p>
        </Card>
      )}

      {(!tenant.recentAlerts || tenant.recentAlerts.length === 0) && (
        <Card className="p-8 text-center opacity-50">
          <p className="text-text-muted">No alerts</p>
        </Card>
      )}
    </div>
  );
}
