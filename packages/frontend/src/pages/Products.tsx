import React, { useState, useMemo } from 'react';
import { Header } from '../components/layout/Header';
import { PageWrapper, PageHeader, EmptyState } from '../components/layout/Layout';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { Badge, ChannelBadge, StatusBadge } from '../components/ui/Badge';
import { DataTable, TableFilter, Column } from '../components/ui/DataTable';
import { cn, formatRelativeTime, formatNumber } from '../lib/utils';
import { useProducts, useUpdateProductStock } from '../hooks/useApi';
import type { Product, ChannelType } from '../types';

export const Products: React.FC = () => {
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<string>('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [newStock, setNewStock] = useState('');

  const { data: products, isLoading } = useProducts({
    search,
    channel: channelFilter || undefined,
  });

  const updateStock = useUpdateProductStock();

  const handleEditStock = (product: Product) => {
    setSelectedProduct(product);
    setNewStock(product.stock.toString());
    setEditModalOpen(true);
  };

  const handleSaveStock = async () => {
    if (!selectedProduct) return;

    await updateStock.mutateAsync({
      productId: selectedProduct.id,
      stock: parseInt(newStock, 10),
    });

    setEditModalOpen(false);
    setSelectedProduct(null);
  };

  const columns: Column<Product>[] = useMemo(
    () => [
      {
        key: 'sku',
        header: 'SKU',
        sortable: true,
        width: '120px',
        render: (product) => (
          <span className="font-mono text-sm text-text-muted">{product.sku}</span>
        ),
      },
      {
        key: 'name',
        header: 'Product Name',
        sortable: true,
        render: (product) => (
          <div>
            <p className="font-medium text-text">{product.name}</p>
            <p className="text-xs text-text-muted mt-0.5">
              {product.channels.length} channel{product.channels.length !== 1 ? 's' : ''}
            </p>
          </div>
        ),
      },
      {
        key: 'stock',
        header: 'Stock',
        sortable: true,
        width: '120px',
        render: (product) => {
          const isLowStock = product.stock <= product.bufferStock;
          const isCritical = product.stock <= product.bufferStock / 2;

          return (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'font-semibold',
                  isCritical ? 'text-error' : isLowStock ? 'text-warning' : 'text-text'
                )}
              >
                {formatNumber(product.stock)}
              </span>
              {isLowStock && (
                <Badge variant={isCritical ? 'error' : 'warning'} size="sm">
                  Low
                </Badge>
              )}
            </div>
          );
        },
      },
      {
        key: 'bufferStock',
        header: 'Buffer',
        sortable: true,
        width: '100px',
        render: (product) => (
          <span className="text-text-muted">{formatNumber(product.bufferStock)}</span>
        ),
      },
      {
        key: 'channels',
        header: 'Channels',
        render: (product) => (
          <div className="flex flex-wrap gap-1">
            {product.channels.map((channel) => (
              <ChannelBadge
                key={channel.channelId}
                channel={channel.channelType}
                showIcon={true}
              />
            ))}
          </div>
        ),
      },
      {
        key: 'lastSync',
        header: 'Last Sync',
        sortable: true,
        width: '140px',
        render: (product) => (
          <span className="text-sm text-text-muted">
            {product.lastSync ? formatRelativeTime(product.lastSync) : 'Never'}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        width: '100px',
        render: (product) => (
          <div className="flex items-center gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleEditStock(product);
              }}
            >
              Edit
            </Button>
          </div>
        ),
      },
    ],
    []
  );

  const channelOptions = [
    { value: '', label: 'All Channels' },
    { value: 'eposnow', label: 'Eposnow' },
    { value: 'wix', label: 'Wix' },
    { value: 'deliveroo', label: 'Deliveroo' },
  ];

  return (
    <>
      <Header title="Products" subtitle="Manage your inventory" />
      <PageWrapper>
        <PageHeader
          title="Products"
          subtitle={`${products?.length ?? 0} products`}
          actions={
            <Button
              leftIcon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              }
            >
              Add Product
            </Button>
          }
        />

        {/* Filters */}
        <Card className="mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <TableFilter
                value={search}
                onChange={setSearch}
                placeholder="Search products..."
              />
            </div>
            <div className="w-full sm:w-48">
              <Select
                options={channelOptions}
                value={channelFilter}
                onChange={setChannelFilter}
                placeholder="Filter by channel"
              />
            </div>
          </div>
        </Card>

        {/* Products Table */}
        <Card padding="none">
          <DataTable
            columns={columns}
            data={products ?? []}
            loading={isLoading}
            keyExtractor={(product) => product.id}
            onRowClick={(product) => handleEditStock(product)}
            emptyMessage="No products found"
            stickyHeader
            className="max-h-[calc(100vh-320px)]"
          />
        </Card>

        {/* Low Stock Summary */}
        {products && products.filter((p) => p.stock <= p.bufferStock).length > 0 && (
          <Card className="mt-6 border-warning/30 bg-warning/5">
            <div className="flex items-start gap-4">
              <div className="p-2 rounded-lg bg-warning/10 text-warning">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h4 className="font-medium text-text">Low Stock Warning</h4>
                <p className="text-sm text-text-muted mt-1">
                  {products.filter((p) => p.stock <= p.bufferStock).length} product(s) are below or at buffer stock level.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {products
                    .filter((p) => p.stock <= p.bufferStock)
                    .slice(0, 5)
                    .map((p) => (
                      <Badge key={p.id} variant="warning">
                        {p.sku}: {p.stock} left
                      </Badge>
                    ))}
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Edit Stock Modal */}
        <Modal
          isOpen={editModalOpen}
          onClose={() => setEditModalOpen(false)}
          title="Edit Stock Level"
          description={selectedProduct ? `Update stock for ${selectedProduct.name}` : undefined}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveStock} loading={updateStock.isPending}>
                Save Changes
              </Button>
            </>
          }
        >
          {selectedProduct && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-background-alt">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-text">{selectedProduct.name}</p>
                    <p className="text-sm text-text-muted">{selectedProduct.sku}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-text-muted">Current Stock</p>
                    <p className="text-xl font-bold text-text">{selectedProduct.stock}</p>
                  </div>
                </div>
              </div>

              <Input
                label="New Stock Level"
                type="number"
                value={newStock}
                onChange={(e) => setNewStock(e.target.value)}
                min={0}
                hint={`Buffer stock level: ${selectedProduct.bufferStock}`}
              />

              <div>
                <p className="text-sm font-medium text-text mb-2">Sync to Channels</p>
                <div className="flex flex-wrap gap-2">
                  {selectedProduct.channels.map((channel) => (
                    <ChannelBadge
                      key={channel.channelId}
                      channel={channel.channelType}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </Modal>
      </PageWrapper>
    </>
  );
};

export default Products;
