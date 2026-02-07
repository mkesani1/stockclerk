import React, { useState, useEffect } from 'react';
import { adminApi } from '../../api/client';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { PageHeader, PageWrapper } from '../../components/layout/Layout';
import { Badge } from '../../components/ui/Badge';
import { Select } from '../../components/ui/Select';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/utils';

interface SyncEvent {
  id: string;
  timestamp: string;
  tenantId: string;
  tenantName?: string;
  channel: string;
  type: string;
  status: 'completed' | 'failed' | 'pending' | 'processing';
  error?: string;
}

export default function AdminSyncMonitor(): React.ReactElement {
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const limit = 50;

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        setLoading(true);
        const params: any = { page, limit };
        if (statusFilter) {
          params.status = statusFilter;
        }
        const data = await adminApi.getSyncEvents(params);
        if (Array.isArray(data)) {
          setEvents(data);
          setTotalPages(1);
        } else if (data.events) {
          setEvents(data.events);
          setTotalPages(data.totalPages || 1);
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load sync events');
      } finally {
        setLoading(false);
      }
    };

    const interval = setInterval(fetchEvents, 30000); // Auto-refresh every 30 seconds
    fetchEvents();

    return () => clearInterval(interval);
  }, [page, statusFilter]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
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
      <PageHeader
        title="Sync Monitor"
        subtitle="Cross-tenant sync event viewer (auto-refreshes every 30 seconds)"
      />

      {error && (
        <Card variant="outlined" className="border-error mb-6 bg-error/5">
          <CardContent className="py-3">
            <p className="text-sm text-error">Error: {error}</p>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card variant="elevated" className="mb-6">
        <CardContent className="py-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Select
              label="Status Filter"
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value);
                setPage(1);
              }}
              options={[
                { label: 'All', value: '' },
                { label: 'Completed', value: 'completed' },
                { label: 'Failed', value: 'failed' },
                { label: 'Pending', value: 'pending' },
                { label: 'Processing', value: 'processing' },
              ]}
            />
            <div className="flex items-end">
              <Button
                variant="secondary"
                onClick={() => {
                  setStatusFilter('');
                  setPage(1);
                }}
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-text-muted">Loading...</p>
        </div>
      ) : events.length === 0 ? (
        <Card variant="elevated">
          <CardContent className="py-12 text-center">
            <p className="text-text-muted">No sync events found</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card variant="elevated">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-bronze-200 bg-background-alt">
                    <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted">Time</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted">Tenant</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted">Channel</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted">Type</th>
                    <th className="px-6 py-3 text-center text-xs font-semibold text-text-muted">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event, idx) => (
                    <tr
                      key={event.id}
                      className={cn(
                        'border-b border-bronze-200 hover:bg-background-alt transition-colors',
                        idx === events.length - 1 && 'border-b-0'
                      )}
                    >
                      <td className="px-6 py-4 text-text-muted whitespace-nowrap">{formatDate(event.timestamp)}</td>
                      <td className="px-6 py-4 text-text font-medium">{event.tenantName || event.tenantId}</td>
                      <td className="px-6 py-4 text-text">{event.channel}</td>
                      <td className="px-6 py-4 text-text">{event.type}</td>
                      <td className="px-6 py-4 text-center">
                        <Badge variant={getStatusBadgeVariant(event.status)} size="sm">
                          {event.status}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-text-muted">
                        {event.error ? (
                          <span className="text-error text-xs truncate max-w-xs block">{event.error}</span>
                        ) : (
                          <span className="text-success text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between">
              <p className="text-sm text-text-muted">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </PageWrapper>
  );
}
