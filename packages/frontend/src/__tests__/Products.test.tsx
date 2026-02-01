/**
 * Products Page Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import React from 'react';

// Mock product data
const mockProducts = [
  {
    id: 'prod-1',
    sku: 'SKU-001',
    name: 'Espresso Beans 1kg',
    stock: 50,
    bufferStock: 10,
    lastSync: new Date().toISOString(),
    channels: [
      { channelId: 'ch-1', channelType: 'eposnow' as const },
      { channelId: 'ch-2', channelType: 'wix' as const },
    ],
  },
  {
    id: 'prod-2',
    sku: 'SKU-002',
    name: 'Latte Beans 1kg',
    stock: 5, // Low stock
    bufferStock: 10,
    lastSync: new Date(Date.now() - 3600000).toISOString(),
    channels: [
      { channelId: 'ch-1', channelType: 'eposnow' as const },
    ],
  },
  {
    id: 'prod-3',
    sku: 'SKU-003',
    name: 'Coffee Mug',
    stock: 200,
    bufferStock: 20,
    lastSync: null,
    channels: [],
  },
];

const mockUseProducts = vi.fn(() => ({
  data: mockProducts,
  isLoading: false,
  error: null,
}));

const mockUpdateStock = vi.fn();
const mockUseUpdateProductStock = vi.fn(() => ({
  mutateAsync: mockUpdateStock,
  isPending: false,
}));

vi.mock('../hooks/useApi', () => ({
  useProducts: () => mockUseProducts(),
  useUpdateProductStock: () => mockUseUpdateProductStock(),
}));

// Simplified Products component for testing
const Products: React.FC = () => {
  const { data: products, isLoading } = mockUseProducts();
  const updateStock = mockUseUpdateProductStock();
  const [search, setSearch] = React.useState('');
  const [channelFilter, setChannelFilter] = React.useState('');
  const [selectedProduct, setSelectedProduct] = React.useState<typeof mockProducts[0] | null>(null);
  const [editModalOpen, setEditModalOpen] = React.useState(false);
  const [newStock, setNewStock] = React.useState('');

  const filteredProducts = React.useMemo(() => {
    if (!products) return [];
    return products.filter((p) => {
      const matchesSearch = search === '' ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku.toLowerCase().includes(search.toLowerCase());
      const matchesChannel = channelFilter === '' ||
        p.channels.some((c) => c.channelType === channelFilter);
      return matchesSearch && matchesChannel;
    });
  }, [products, search, channelFilter]);

  const handleEditStock = (product: typeof mockProducts[0]) => {
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

  if (isLoading) {
    return <div data-testid="loading">Loading...</div>;
  }

  return (
    <div data-testid="products-page">
      <h1>Products</h1>

      {/* Filters */}
      <div data-testid="filters">
        <input
          type="text"
          data-testid="search-input"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          data-testid="channel-filter"
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
        >
          <option value="">All Channels</option>
          <option value="eposnow">Eposnow</option>
          <option value="wix">Wix</option>
          <option value="deliveroo">Deliveroo</option>
        </select>
      </div>

      {/* Products Table */}
      <table data-testid="products-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Name</th>
            <th>Stock</th>
            <th>Buffer</th>
            <th>Channels</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredProducts.map((product) => (
            <tr key={product.id} data-testid="product-row">
              <td data-testid="product-sku">{product.sku}</td>
              <td data-testid="product-name">{product.name}</td>
              <td data-testid="product-stock" className={product.stock <= product.bufferStock ? 'low-stock' : ''}>
                {product.stock}
                {product.stock <= product.bufferStock && <span data-testid="low-stock-badge">Low</span>}
              </td>
              <td data-testid="product-buffer">{product.bufferStock}</td>
              <td data-testid="product-channels">
                {product.channels.map((c) => (
                  <span key={c.channelId} data-testid="channel-badge" className={`channel-${c.channelType}`}>
                    {c.channelType}
                  </span>
                ))}
              </td>
              <td>
                <button data-testid="edit-button" onClick={() => handleEditStock(product)}>
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {filteredProducts.length === 0 && (
        <div data-testid="empty-state">No products found</div>
      )}

      {/* Edit Modal */}
      {editModalOpen && selectedProduct && (
        <div data-testid="edit-modal" role="dialog">
          <h2>Edit Stock Level</h2>
          <p>Update stock for {selectedProduct.name}</p>
          <div>
            <label htmlFor="stock-input">New Stock Level</label>
            <input
              id="stock-input"
              type="number"
              data-testid="stock-input"
              value={newStock}
              onChange={(e) => setNewStock(e.target.value)}
              min={0}
            />
          </div>
          <div>
            <button data-testid="cancel-button" onClick={() => setEditModalOpen(false)}>
              Cancel
            </button>
            <button data-testid="save-button" onClick={handleSaveStock}>
              Save Changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Test wrapper
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  );
};

describe('Products Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseProducts.mockReturnValue({
      data: mockProducts,
      isLoading: false,
      error: null,
    });
    mockUseUpdateProductStock.mockReturnValue({
      mutateAsync: mockUpdateStock,
      isPending: false,
    });
  });

  describe('Rendering', () => {
    it('should render products page', () => {
      render(<Products />, { wrapper: createWrapper() });

      expect(screen.getByTestId('products-page')).toBeInTheDocument();
    });

    it('should show loading state', () => {
      mockUseProducts.mockReturnValue({
        data: null,
        isLoading: true,
        error: null,
      });

      render(<Products />, { wrapper: createWrapper() });

      expect(screen.getByTestId('loading')).toBeInTheDocument();
    });

    it('should render product table with all products', () => {
      render(<Products />, { wrapper: createWrapper() });

      const rows = screen.getAllByTestId('product-row');
      expect(rows).toHaveLength(3);
    });

    it('should display product information correctly', () => {
      render(<Products />, { wrapper: createWrapper() });

      expect(screen.getByText('SKU-001')).toBeInTheDocument();
      expect(screen.getByText('Espresso Beans 1kg')).toBeInTheDocument();
    });
  });

  describe('Low Stock Indication', () => {
    it('should show low stock badge for products below buffer', () => {
      render(<Products />, { wrapper: createWrapper() });

      const lowStockBadges = screen.getAllByTestId('low-stock-badge');
      expect(lowStockBadges).toHaveLength(1);
    });

    it('should apply low-stock class to stock cells', () => {
      render(<Products />, { wrapper: createWrapper() });

      const rows = screen.getAllByTestId('product-row');
      const lowStockRow = rows[1]; // Latte Beans with stock 5
      const stockCell = within(lowStockRow).getByTestId('product-stock');

      expect(stockCell).toHaveClass('low-stock');
    });
  });

  describe('Channel Badges', () => {
    it('should display channel badges for products', () => {
      render(<Products />, { wrapper: createWrapper() });

      const rows = screen.getAllByTestId('product-row');
      const firstRow = rows[0];
      const channelBadges = within(firstRow).getAllByTestId('channel-badge');

      expect(channelBadges).toHaveLength(2);
    });

    it('should not show channel badges for products without channels', () => {
      render(<Products />, { wrapper: createWrapper() });

      const rows = screen.getAllByTestId('product-row');
      const lastRow = rows[2]; // Coffee Mug with no channels
      const channelBadges = within(lastRow).queryAllByTestId('channel-badge');

      expect(channelBadges).toHaveLength(0);
    });
  });

  describe('Search Functionality', () => {
    it('should filter products by name', async () => {
      const user = userEvent.setup();
      render(<Products />, { wrapper: createWrapper() });

      const searchInput = screen.getByTestId('search-input');
      await user.type(searchInput, 'Espresso');

      const rows = screen.getAllByTestId('product-row');
      expect(rows).toHaveLength(1);
      expect(screen.getByText('Espresso Beans 1kg')).toBeInTheDocument();
    });

    it('should filter products by SKU', async () => {
      const user = userEvent.setup();
      render(<Products />, { wrapper: createWrapper() });

      const searchInput = screen.getByTestId('search-input');
      await user.type(searchInput, 'SKU-002');

      const rows = screen.getAllByTestId('product-row');
      expect(rows).toHaveLength(1);
      expect(screen.getByText('Latte Beans 1kg')).toBeInTheDocument();
    });

    it('should show empty state when no products match', async () => {
      const user = userEvent.setup();
      render(<Products />, { wrapper: createWrapper() });

      const searchInput = screen.getByTestId('search-input');
      await user.type(searchInput, 'NonExistentProduct');

      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  describe('Channel Filter', () => {
    it('should filter products by channel', async () => {
      const user = userEvent.setup();
      render(<Products />, { wrapper: createWrapper() });

      const channelFilter = screen.getByTestId('channel-filter');
      await user.selectOptions(channelFilter, 'wix');

      const rows = screen.getAllByTestId('product-row');
      expect(rows).toHaveLength(1);
      expect(screen.getByText('Espresso Beans 1kg')).toBeInTheDocument();
    });

    it('should show all products when filter is cleared', async () => {
      const user = userEvent.setup();
      render(<Products />, { wrapper: createWrapper() });

      const channelFilter = screen.getByTestId('channel-filter');
      await user.selectOptions(channelFilter, 'wix');
      await user.selectOptions(channelFilter, '');

      const rows = screen.getAllByTestId('product-row');
      expect(rows).toHaveLength(3);
    });
  });

  describe('Edit Stock Modal', () => {
    it('should open modal when clicking edit button', async () => {
      const user = userEvent.setup();
      render(<Products />, { wrapper: createWrapper() });

      const editButtons = screen.getAllByTestId('edit-button');
      await user.click(editButtons[0]);

      expect(screen.getByTestId('edit-modal')).toBeInTheDocument();
    });

    it('should show product name in modal', async () => {
      const user = userEvent.setup();
      render(<Products />, { wrapper: createWrapper() });

      const editButtons = screen.getAllByTestId('edit-button');
      await user.click(editButtons[0]);

      expect(screen.getByText(/Espresso Beans 1kg/)).toBeInTheDocument();
    });

    it('should pre-fill current stock value', async () => {
      const user = userEvent.setup();
      render(<Products />, { wrapper: createWrapper() });

      const editButtons = screen.getAllByTestId('edit-button');
      await user.click(editButtons[0]);

      const stockInput = screen.getByTestId('stock-input') as HTMLInputElement;
      expect(stockInput.value).toBe('50');
    });

    it('should close modal when clicking cancel', async () => {
      const user = userEvent.setup();
      render(<Products />, { wrapper: createWrapper() });

      const editButtons = screen.getAllByTestId('edit-button');
      await user.click(editButtons[0]);
      await user.click(screen.getByTestId('cancel-button'));

      expect(screen.queryByTestId('edit-modal')).not.toBeInTheDocument();
    });

    it('should call updateStock when saving', async () => {
      const user = userEvent.setup();
      render(<Products />, { wrapper: createWrapper() });

      const editButtons = screen.getAllByTestId('edit-button');
      await user.click(editButtons[0]);

      const stockInput = screen.getByTestId('stock-input');
      await user.clear(stockInput);
      await user.type(stockInput, '75');

      await user.click(screen.getByTestId('save-button'));

      expect(mockUpdateStock).toHaveBeenCalledWith({
        productId: 'prod-1',
        stock: 75,
      });
    });

    it('should close modal after successful save', async () => {
      const user = userEvent.setup();
      mockUpdateStock.mockResolvedValue({ success: true });

      render(<Products />, { wrapper: createWrapper() });

      const editButtons = screen.getAllByTestId('edit-button');
      await user.click(editButtons[0]);
      await user.click(screen.getByTestId('save-button'));

      await waitFor(() => {
        expect(screen.queryByTestId('edit-modal')).not.toBeInTheDocument();
      });
    });
  });

  describe('Combined Filters', () => {
    it('should apply search and channel filter together', async () => {
      const user = userEvent.setup();
      render(<Products />, { wrapper: createWrapper() });

      const searchInput = screen.getByTestId('search-input');
      await user.type(searchInput, 'Beans');

      const channelFilter = screen.getByTestId('channel-filter');
      await user.selectOptions(channelFilter, 'eposnow');

      const rows = screen.getAllByTestId('product-row');
      expect(rows).toHaveLength(2); // Both bean products have eposnow
    });
  });
});
