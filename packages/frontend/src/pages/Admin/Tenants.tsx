import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../../api/client';
import { Card, CardContent } from '../../components/ui/Card';
import { PageHeader, PageWrapper } from '../../components/layout/Layout';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/utils';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  userCount?: number;
  productCount?: number;
  channelCount?: number;
  syncs24h?: number;
  createdAt: string;
}

export default function AdminTenants(): React.ReactElement {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const limit = 20;

  useEffect(() => {
    const fetchTenants = async () => {
      try {
        setLoading(true);
        const data = await adminApi.getTenants({ page, limit });
        if (Array.isArray(data)) {
          setTenants(data);
          // Assume single page if no pagination info
          setTotalPages(1);
        } else if (data.tenants) {
          setTenants(data.tenants);
          setTotalPages(data.totalPages || 1);
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tenants');
      } finally {
        setLoading(false);
      }
    };

    fetchTenants();
  }, [page]);

  const handleRowClick = (tenantId: string) => {
    navigate(`/admin/tenants/${tenantId}`);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <PageWrapper>
      <PageHeader
        title="Tenants"
        subtitle="Manage all tenants in the system"
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
      ) : tenants.length === 0 ? (
        <Card variant="elevated">
          <CardContent className="py-12 text-center">
            <p className="text-text-muted">No tenants found</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card variant="elevated">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-bronze-200">
                    <th className="px-6 py-3 text-left text-sm font-semibold text-text-muted">Name</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-text-muted">Slug</th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-text-muted">Users</th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-text-muted">Products</th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-text-muted">Channels</th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-text-muted">Syncs (24h)</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-text-muted">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((tenant, idx) => (
                    <tr
                      key={tenant.id}
                      className={cn(
                        'border-b border-bronze-200 hover:bg-background-alt transition-colors cursor-pointer',
                        idx === tenants.length - 1 && 'border-b-0'
                      )}
                      onClick={() => handleRowClick(tenant.id)}
                    >
                      <td className="px-6 py-4 text-sm font-medium text-text">{tenant.name}</td>
                      <td className="px-6 py-4 text-sm text-text-muted font-mono">{tenant.slug}</td>
                      <td className="px-6 py-4 text-sm text-text text-center">{tenant.userCount ?? 0}</td>
                      <td className="px-6 py-4 text-sm text-text text-center">{tenant.productCount ?? 0}</td>
                      <td className="px-6 py-4 text-sm text-text text-center">{tenant.channelCount ?? 0}</td>
                      <td className="px-6 py-4 text-sm text-text text-center">{tenant.syncs24h ?? 0}</td>
                      <td className="px-6 py-4 text-sm text-text-muted">{formatDate(tenant.createdAt)}</td>
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
