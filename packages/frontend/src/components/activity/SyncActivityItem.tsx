import React, { useState } from 'react';
import { cn, formatRelativeTime, formatDate, formatNumber } from '../../lib/utils';
import { ChannelBadge } from '../ui/Badge';
import type { ChannelType } from '../../types';

export type SyncEventType =
  | 'stock_updated'
  | 'sync_started'
  | 'sync_completed'
  | 'sync_error'
  | 'alert_triggered';

export interface SyncActivityItemData {
  id: string;
  type: SyncEventType;
  timestamp: string;
  productId?: string;
  productName?: string;
  channelType?: ChannelType;
  channelName?: string;
  oldValue?: number;
  newValue?: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface SyncActivityItemProps {
  activity: SyncActivityItemData;
  compact?: boolean;
  className?: string;
  onClick?: () => void;
}

// Event type configuration
const eventTypeConfig: Record<
  SyncEventType,
  { icon: string; label: string; bgClass: string; textClass: string; borderClass: string }
> = {
  stock_updated: {
    icon: '\u21BB', // Rotation arrow
    label: 'Stock Updated',
    bgClass: 'bg-primary/10',
    textClass: 'text-primary',
    borderClass: 'border-primary/20',
  },
  sync_started: {
    icon: '\u25B6', // Play
    label: 'Sync Started',
    bgClass: 'bg-blue-50',
    textClass: 'text-blue-600',
    borderClass: 'border-blue-200',
  },
  sync_completed: {
    icon: '\u2713', // Checkmark
    label: 'Sync Completed',
    bgClass: 'bg-success/10',
    textClass: 'text-success',
    borderClass: 'border-success/20',
  },
  sync_error: {
    icon: '\u2717', // X mark
    label: 'Sync Error',
    bgClass: 'bg-error/10',
    textClass: 'text-error',
    borderClass: 'border-error/20',
  },
  alert_triggered: {
    icon: '\u26A0', // Warning
    label: 'Alert',
    bgClass: 'bg-warning/10',
    textClass: 'text-warning',
    borderClass: 'border-warning/20',
  },
};

export const SyncActivityItem: React.FC<SyncActivityItemProps> = ({
  activity,
  compact = false,
  className,
  onClick,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const config = eventTypeConfig[activity.type];

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      setIsExpanded(!isExpanded);
    }
  };

  const hasValueChange =
    activity.oldValue !== undefined && activity.newValue !== undefined;

  return (
    <div
      className={cn(
        'group rounded-lg border transition-all duration-200 cursor-pointer',
        'hover:shadow-soft hover:border-bronze-300',
        isExpanded ? 'bg-background-alt/50' : 'bg-white',
        config.borderClass,
        className
      )}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleClick();
        }
      }}
    >
      {/* Main Row */}
      <div className={cn('flex items-center gap-3', compact ? 'p-2' : 'p-3')}>
        {/* Event Type Icon */}
        <div
          className={cn(
            'flex items-center justify-center rounded-lg shrink-0 font-mono',
            config.bgClass,
            config.textClass,
            compact ? 'w-8 h-8 text-sm' : 'w-10 h-10 text-base'
          )}
        >
          {config.icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {/* Event Type Label */}
            <span
              className={cn(
                'font-medium truncate',
                compact ? 'text-xs' : 'text-sm',
                config.textClass
              )}
            >
              {config.label}
            </span>

            {/* Product Name */}
            {activity.productName && (
              <>
                <span className="text-text-muted">-</span>
                <span className="text-text truncate text-sm">
                  {activity.productName}
                </span>
              </>
            )}
          </div>

          {/* Secondary Info */}
          <div className="flex items-center gap-2 mt-1">
            <span className={cn('text-text-muted', compact ? 'text-xs' : 'text-xs')}>
              {formatRelativeTime(activity.timestamp)}
            </span>

            {activity.channelType && (
              <ChannelBadge channel={activity.channelType} showIcon={false} />
            )}

            {/* Value Change */}
            {hasValueChange && (
              <span className="flex items-center gap-1 text-xs">
                <span className="text-text-muted line-through">
                  {formatNumber(activity.oldValue!)}
                </span>
                <span className="text-text-muted">{'\u2192'}</span>
                <span
                  className={cn(
                    'font-medium',
                    activity.newValue! < activity.oldValue!
                      ? 'text-error'
                      : 'text-success'
                  )}
                >
                  {formatNumber(activity.newValue!)}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Expand Indicator */}
        <svg
          className={cn(
            'w-4 h-4 text-text-muted transition-transform duration-200 shrink-0',
            isExpanded && 'rotate-180'
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-2 border-t border-bronze-200 space-y-2 animate-fade-in">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-text-muted">Event ID:</span>
              <span className="ml-1 text-text font-mono">{activity.id}</span>
            </div>
            <div>
              <span className="text-text-muted">Time:</span>
              <span className="ml-1 text-text">{formatDate(activity.timestamp)}</span>
            </div>
            {activity.productId && (
              <div>
                <span className="text-text-muted">Product ID:</span>
                <span className="ml-1 text-text font-mono">{activity.productId}</span>
              </div>
            )}
            {activity.channelName && (
              <div>
                <span className="text-text-muted">Channel:</span>
                <span className="ml-1 text-text">{activity.channelName}</span>
              </div>
            )}
          </div>

          {activity.message && (
            <div className="text-xs">
              <span className="text-text-muted">Message:</span>
              <p className="mt-1 text-text bg-background-alt p-2 rounded-lg">
                {activity.message}
              </p>
            </div>
          )}

          {activity.details && Object.keys(activity.details).length > 0 && (
            <div className="text-xs">
              <span className="text-text-muted">Additional Details:</span>
              <pre className="mt-1 text-text bg-background-alt p-2 rounded-lg overflow-x-auto">
                {JSON.stringify(activity.details, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SyncActivityItem;
