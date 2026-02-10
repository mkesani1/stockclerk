import React, { useState, useEffect } from 'react';
import { adminApi } from '../../api/client';
import { Card, CardContent } from '../../components/ui/Card';
import { PageHeader, PageWrapper } from '../../components/layout/Layout';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { cn } from '../../lib/utils';

interface SyncEvent {
  id: string;
  tenantId: string;
  eventType: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  errorMessage?: string;
  createdAt: string;
  channelName?: string;
  tenantName?: string;
}

const statusColors = {
  pending: 'gray',
  processing: 'blue',
  completed: 'green',
  failed: 'red',
};

const statusVariants: Record<string, any> = {
  pending: 'default',
  processing: 'primary',
  completed: 'success',
  failed: 'error',
};

export default function AdminSyncMonitor(): React.ReactElement {
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const limit = 20;

  const fetchEvents = async () => {
    try {
      setLoading(true);
      const params: any = { page, limit };
      if (statusFilter) {
        params.status = statusFilter;
      }
      const data = await adminApi.getSyncEvents(params);
      setEvents(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sync events');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [page, statusFilter]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchEvents();
    }, 10000);

    return () => clearInterval(interval);
  }, [autoRefresh, page, statusFilter]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const handleStatusFilter = (status: string) => {
    setStatusFilter(status);
    setPage(1);
  };

  return (
    <PageWrapper>
      <PageHeader
        title="Sync Monitor"
        subtitle="Cross-tenant sync event feed"
      />

      {error && (
        <Card variant="outlined" className="border-error mb-6 bg-error/5">
          <CardContent className="py-3">
            <p className="text-sm text-error">Error: {error}</p>
          </CardContent>
        </Card>
      )}

      {/* Status Filter Buttons */}
      <Card variant="elevated" className="mb-6">
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-2 mb-4">
            <Button
              variant={statusFilter === '' ? 'primary' : 'outline'}
              onClick={() => handleStatusFilter('')}
              size="sm"
            >
              All
            </Button>
            <Button
              variant={statusFilter === 'pending' ? 'primary' : 'outline'}
              onClick={() => handleStatusFilter('pending')}
              size="sm"
            >
              Pending
            </Button>
            <Button
              variant={statusFilter === 'processing' ? 'primary' : 'outline'}
              onClick={() => handleStatusFilter('processing')}
              size="sm"
            >
              Processing
            </Button>
            <Button
              variant={statusFilter === 'completed' ? 'primary' : 'outline'}
              onClick={() => handleStatusFilter('completed')}
              size="sm"
            >
              Completed
            </Button>
            <Button
              variant={statusFilter === 'failed' ? 'primary' : 'outline'}
              onClick={() => handleStatusFilter('failed')}
              size="sm"
            >
              Failed
            </Button>
          </div>

          {/* Auto-refresh toggle */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="w-4 h-4 rounded border-bronze-200 accent-primary"
              />
              <span className="text-sm text-text-muted">
                Auto-refresh (10 seconds)
              </span>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Events List */}
      {loading && !events.length ? (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      ) : events.length === 0 ? (
        <Card variant="elevated">
          <CardContent className="py-12 text-center">
            <p className="text-text-muted">No sync events found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <Card key={event.id} variant="elevated" className="hover:shadow-md transition-shadow">
              <CardContent className="py-4">
                <div className="space-y-3">
                  {/* Status Badge and Event Type */}
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Badge variant={statusVariants[event.status] || 'default'} size="sm">
                          {event.status}
                        </Badge>
                        <span className="text-sm font-medium text-text">{event.eventType}</span>
                      </div>
                    </div>
                    <span className="text-xs text-text-muted whitespace-nowrap ml-4">
                      {formatDate(event.createdAt)}
                    </span>
                  </div>

                  {/* Tenant and Channel Info */}
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-text-muted mb-1">Tenant</p>
                      <p className="text-text font-medium">{event.tenantName || event.tenantId}</p>
                    </div>
                    {event.channelName && (
                      <div>
                        <p className="text-xs text-text-muted mb-1">Channel</p>
                        <p className="text-text font-medium">{event.channelName}</p>
                      </div>
                    )}
                  </div>

                  {/* Error Message (if failed) */}
                  {event.errorMessage && event.status === 'failed' && (
                    <div className="pt-3 border-t border-bronze-100">
                      <p className="text-xs text-text-muted mb-1">Error</p>
                      <p className="text-sm text-error font-mono bg-error/5 p-2 rounded">
                        {event.errorMessage}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Loading indicator for refresh */}
      {loading && events.length > 0 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Spinner size="sm" />
          <span className="text-sm text-text-muted">Updating...</span>
        </div>
      )}
    </PageWrapper>
  );
}
