import React, { useState, useEffect, useCallback } from 'react';
import { cn, formatNumber, formatRelativeTime } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { ChannelBadge } from '../ui/Badge';
import type { ChannelType } from '../../types';

export interface StockChangeData {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  channelType: ChannelType;
  channelName: string;
  previousStock: number;
  newStock: number;
  timestamp: string;
  reason?: string;
}

export interface StockChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  stockChange?: StockChangeData | null;
  onAdjust?: (productId: string, adjustedStock: number) => void;
  onAccept?: (productId: string) => void;
  isAdjusting?: boolean;
}

export const StockChangeModal: React.FC<StockChangeModalProps> = ({
  isOpen,
  onClose,
  stockChange: initialStockChange = null,
  onAdjust,
  onAccept,
  isAdjusting = false,
}) => {
  const [stockChange, setStockChange] = useState<StockChangeData | null>(initialStockChange);
  const [adjustedStock, setAdjustedStock] = useState<string>('');
  const [showAdjustInput, setShowAdjustInput] = useState(false);

  // Update state when prop changes
  useEffect(() => {
    setStockChange(initialStockChange);
    setAdjustedStock(initialStockChange?.newStock.toString() ?? '');
    setShowAdjustInput(false);
  }, [initialStockChange]);

  // Handler for external stock change events (from WebSocket)
  const handleStockChangeEvent = useCallback((payload: StockChangeData) => {
    setStockChange(payload);
    setAdjustedStock(payload.newStock.toString());
    setShowAdjustInput(false);
  }, []);

  // Listen for stock change events
  useEffect(() => {
    const handleEvent = (event: CustomEvent) => {
      handleStockChangeEvent(event.detail);
    };

    window.addEventListener('stock:external_change' as any, handleEvent);
    return () => {
      window.removeEventListener('stock:external_change' as any, handleEvent);
    };
  }, [handleStockChangeEvent]);

  const handleAccept = () => {
    if (stockChange && onAccept) {
      onAccept(stockChange.productId);
    }
    onClose();
  };

  const handleAdjust = () => {
    if (stockChange && onAdjust && adjustedStock) {
      const parsedStock = parseInt(adjustedStock, 10);
      if (!isNaN(parsedStock) && parsedStock >= 0) {
        onAdjust(stockChange.productId, parsedStock);
      }
    }
    onClose();
  };

  if (!stockChange) {
    return null;
  }

  const stockDifference = stockChange.newStock - stockChange.previousStock;
  const isStockDecrease = stockDifference < 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="External Stock Change Detected"
      size="md"
      footer={
        showAdjustInput ? (
          <>
            <Button
              variant="secondary"
              onClick={() => setShowAdjustInput(false)}
              disabled={isAdjusting}
            >
              Back
            </Button>
            <Button
              variant="primary"
              onClick={handleAdjust}
              loading={isAdjusting}
              disabled={!adjustedStock || isNaN(parseInt(adjustedStock, 10))}
            >
              Apply Adjustment
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Dismiss
            </Button>
            <Button variant="outline" onClick={() => setShowAdjustInput(true)}>
              Adjust Stock
            </Button>
            <Button variant="primary" onClick={handleAccept}>
              Accept Change
            </Button>
          </>
        )
      }
    >
      {/* Alert Banner */}
      <div
        className={cn(
          'flex items-start gap-3 p-4 rounded-xl mb-6',
          isStockDecrease
            ? 'bg-warning/10 border border-warning/20'
            : 'bg-primary/10 border border-primary/20'
        )}
      >
        <div
          className={cn(
            'w-10 h-10 rounded-lg flex items-center justify-center text-xl shrink-0',
            isStockDecrease ? 'bg-warning/20 text-warning' : 'bg-primary/20 text-primary'
          )}
        >
          {isStockDecrease ? '\u26A0' : '\u2139'}
        </div>
        <div>
          <p className={cn('font-medium', isStockDecrease ? 'text-warning' : 'text-primary')}>
            Stock level changed externally
          </p>
          <p className="text-sm text-text-muted mt-0.5">
            This change was detected from an external source. Review the details below.
          </p>
        </div>
      </div>

      {/* Product Info */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4 p-4 bg-background-alt rounded-xl">
          <div>
            <h4 className="font-semibold text-text">{stockChange.productName}</h4>
            <p className="text-sm text-text-muted font-mono">{stockChange.sku}</p>
          </div>
          <ChannelBadge channel={stockChange.channelType} />
        </div>

        {/* Stock Change Visualization */}
        <div className="flex items-center justify-center gap-6 py-6">
          {/* Previous Stock */}
          <div className="text-center">
            <p className="text-xs text-text-muted mb-1">Previous</p>
            <p className="text-3xl font-bold text-text-muted">
              {formatNumber(stockChange.previousStock)}
            </p>
          </div>

          {/* Arrow */}
          <div
            className={cn(
              'flex items-center justify-center w-12 h-12 rounded-full',
              isStockDecrease ? 'bg-error/10' : 'bg-success/10'
            )}
          >
            <span
              className={cn(
                'text-2xl',
                isStockDecrease ? 'text-error' : 'text-success'
              )}
            >
              {isStockDecrease ? '\u2193' : '\u2191'}
            </span>
          </div>

          {/* New Stock */}
          <div className="text-center">
            <p className="text-xs text-text-muted mb-1">New</p>
            <p
              className={cn(
                'text-3xl font-bold',
                isStockDecrease ? 'text-error' : 'text-success'
              )}
            >
              {formatNumber(stockChange.newStock)}
            </p>
          </div>
        </div>

        {/* Change Details */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="p-3 bg-background-alt rounded-lg">
            <p className="text-text-muted text-xs mb-0.5">Change</p>
            <p
              className={cn(
                'font-semibold',
                isStockDecrease ? 'text-error' : 'text-success'
              )}
            >
              {stockDifference > 0 ? '+' : ''}
              {formatNumber(stockDifference)} units
            </p>
          </div>
          <div className="p-3 bg-background-alt rounded-lg">
            <p className="text-text-muted text-xs mb-0.5">Source</p>
            <p className="font-semibold text-text">{stockChange.channelName}</p>
          </div>
          <div className="p-3 bg-background-alt rounded-lg">
            <p className="text-text-muted text-xs mb-0.5">Detected</p>
            <p className="font-semibold text-text">
              {formatRelativeTime(stockChange.timestamp)}
            </p>
          </div>
          {stockChange.reason && (
            <div className="p-3 bg-background-alt rounded-lg">
              <p className="text-text-muted text-xs mb-0.5">Reason</p>
              <p className="font-semibold text-text">{stockChange.reason}</p>
            </div>
          )}
        </div>

        {/* Adjust Input */}
        {showAdjustInput && (
          <div className="pt-4 border-t border-bronze-200 space-y-3 animate-fade-in">
            <p className="text-sm text-text-muted">
              Enter the correct stock level if the detected change is incorrect:
            </p>
            <Input
              type="number"
              min={0}
              value={adjustedStock}
              onChange={(e) => setAdjustedStock(e.target.value)}
              placeholder="Enter correct stock level"
              label="Adjusted Stock"
            />
          </div>
        )}
      </div>
    </Modal>
  );
};

// Export a helper function to dispatch stock change events
export const dispatchStockChange = (stockChange: StockChangeData) => {
  window.dispatchEvent(new CustomEvent('stock:external_change', { detail: stockChange }));
};

export default StockChangeModal;
