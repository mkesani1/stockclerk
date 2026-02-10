import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../../api/client';
import { Button, Card, Badge, Spinner } from '../../components/ui';
import { cn } from '../../lib/utils';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  userCount: number;
  productCount: number;
  channelCount: number;
  syncEventCountLast24h: number;
}

export default function Tenants() {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const fetchTenants = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await adminApi.getTenants();
        setTenants(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch tenants');
      } finally {
        setLoading(false);
      }
    };

    fetchTenants();
  }, []);

  const filteredTenants = tenants.filter(tenant =>
    tenant.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    tenant.slug.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleTenantClick = (tenantId: string) => {
    navigate(`/admin/tenants/${tenantId}`);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text">Tenants</h1>
        <p className="text-text-muted mt-1">All registered businesses</p>
      </div>

      {/* Search Bar */}
      <Card className="p-4">
        <input
          type="text"
          placeholder="Search by name or slug..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-4 py-2 rounded-lg border border-bronze-200 bg-background text-text placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </Card>

      {/* Error Message */}
      {error && (
        <Card className="p-4 bg-error/10 border border-error">
          <p className="text-error font-medium">{error}</p>
        </Card>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <Spinner />
        </div>
      )}

      {/* Table */}
      {!loading && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-bronze-200 bg-background-alt">
                  <th className="px-6 py-3 text-left text-sm font-semibold text-text">Name</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-text">Slug</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-text">Users</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-text">Products</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-text">Channels</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-text">Syncs (24h)</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-text">Created</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-text">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTenants.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-8 text-center text-text-muted">
                      {tenants.length === 0 ? 'No tenants found' : 'No results match your search'}
                    </td>
                  </tr>
                ) : (
                  filteredTenants.map((tenant) => (
                    <tr key={tenant.id} className="border-b border-bronze-200 hover:bg-background-alt transition-colors">
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleTenantClick(tenant.id)}
                          className="text-primary font-medium hover:underline text-left"
                        >
                          {tenant.name}
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        <code className="text-sm bg-background-alt px-2 py-1 rounded text-text-muted">
                          {tenant.slug}
                        </code>
                      </td>
                      <td className="px-6 py-4 text-text text-sm">
                        {tenant.userCount}
                      </td>
                      <td className="px-6 py-4 text-text text-sm">
                        {tenant.productCount}
                      </td>
                      <td className="px-6 py-4 text-text text-sm">
                        {tenant.channelCount}
                      </td>
                      <td className="px-6 py-4 text-text text-sm">
                        {tenant.syncEventCountLast24h}
                      </td>
                      <td className="px-6 py-4 text-text-muted text-sm">
                        {formatDate(tenant.createdAt)}
                      </td>
                      <td className="px-6 py-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTenantClick(tenant.id)}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Empty State */}
      {!loading && tenants.length === 0 && !error && (
        <Card className="p-12 text-center">
          <p className="text-text-muted text-lg">No tenants available</p>
        </Card>
      )}
    </div>
  );
}
