import React, { useState, useEffect, useCallback } from 'react';
import { cn, formatRelativeTime } from '../../lib/utils';
import type { ChannelType } from '../../types';

export interface SyncProgressData {
  channelType: ChannelType;
  channelName: string;
  progress: number; // 0-100
  itemsSynced: number;
  totalItems: number;
  startedAt: string;
  currentProduct?: string;
}

export interface LiveSyncIndicatorProps {
  syncProgress?: SyncProgressData | null;
  isVisible?: boolean;
  position?: 'top' | 'bottom' | 'inline';
  className?: string;
  onCancel?: () => void;
}

// Channel icons
const channelIcons: Record<ChannelType, string> = {
  eposnow: '\u25CE',   // Circle
  wix: '\u25C7',       // Diamond
  deliveroo: '\u25B3', // Triangle
};

// Channel colors
const channelColors: Record<ChannelType, string> = {
  eposnow: 'text-blue-600 bg-blue-50 border-blue-200',
  wix: 'text-purple-600 bg-purple-50 border-purple-200',
  deliveroo: 'text-teal-600 bg-teal-50 border-teal-200',
};

export const LiveSyncIndicator: React.FC<LiveSyncIndicatorProps> = ({
  syncProgress: initialSyncProgress = null,
  isVisible: initialIsVisible = false,
  position = 'inline',
  className,
  onCancel,
}) => {
  const [syncProgress, setSyncProgress] = useState<SyncProgressData | null>(initialSyncProgress);
  const [isVisible, setIsVisible] = useState(initialIsVisible);

  // Update state when props change
  useEffect(() => {
    setSyncProgress(initialSyncProgress);
    setIsVisible(initialIsVisible || !!initialSyncProgress);
  }, [initialSyncProgress, initialIsVisible]);

  // Handler for sync progress updates (from WebSocket)
  const handleSyncProgress = useCallback((payload: SyncProgressData | null) => {
    setSyncProgress(payload);
    setIsVisible(!!payload);
  }, []);

  // Listen for sync progress events
  useEffect(() => {
    const handleEvent = (event: CustomEvent) => {
      handleSyncProgress(event.detail);
    };

    window.addEventListener('sync:progress' as any, handleEvent);
    return () => {
      window.removeEventListener('sync:progress' as any, handleEvent);
    };
  }, [handleSyncProgress]);

  if (!isVisible || !syncProgress) {
    return null;
  }

  const positionStyles = {
    top: 'fixed top-0 left-0 right-0 z-50',
    bottom: 'fixed bottom-0 left-0 right-0 z-50',
    inline: '',
  };

  return (
    <div
      className={cn(
        'animate-fade-in',
        positionStyles[position],
        className
      )}
    >
      <div
        className={cn(
          'flex items-center gap-4 p-4 rounded-xl border shadow-soft bg-white',
          position !== 'inline' && 'mx-4 my-2',
          channelColors[syncProgress.channelType]
        )}
      >
        {/* Animated Sync Icon */}
        <div className="relative">
          <div
            className={cn(
              'w-12 h-12 rounded-xl flex items-center justify-center text-2xl font-mono',
              channelColors[syncProgress.channelType]
            )}
          >
            <span className="animate-spin" style={{ animationDuration: '2s' }}>
              {'\u21BB'}
            </span>
          </div>
          {/* Channel Badge */}
          <div
            className={cn(
              'absolute -bottom-1 -right-1 w-6 h-6 rounded-lg flex items-center justify-center text-xs font-mono border-2 border-white',
              channelColors[syncProgress.channelType]
            )}
          >
            {channelIcons[syncProgress.channelType]}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-text">Syncing</span>
              <span className="text-text-muted">to</span>
              <span className="font-medium text-text">{syncProgress.channelName}</span>
            </div>
            <span className="text-sm font-medium text-text">
              {syncProgress.progress}%
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full h-2 bg-bronze-100 rounded-full overflow-hidden mb-2">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                syncProgress.channelType === 'eposnow' && 'bg-blue-500',
                syncProgress.channelType === 'wix' && 'bg-purple-500',
                syncProgress.channelType === 'deliveroo' && 'bg-teal-500'
              )}
              style={{ width: `${syncProgress.progress}%` }}
            />
          </div>

          {/* Status Info */}
          <div className="flex items-center justify-between text-xs text-text-muted">
            <div className="flex items-center gap-2 truncate">
              <span>
                {syncProgress.itemsSynced} / {syncProgress.totalItems} items
              </span>
              {syncProgress.currentProduct && (
                <>
                  <span className="text-bronze-300">|</span>
                  <span className="truncate">{syncProgress.currentProduct}</span>
                </>
              )}
            </div>
            <span>Started {formatRelativeTime(syncProgress.startedAt)}</span>
          </div>
        </div>

        {/* Cancel Button */}
        {onCancel && (
          <button
            onClick={onCancel}
            className="p-2 text-text-muted hover:text-error hover:bg-error/10 rounded-lg transition-colors shrink-0"
            title="Cancel sync"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Pulsing indicator bar for fixed positions */}
      {position !== 'inline' && (
        <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-primary/20 via-primary to-primary/20 animate-pulse" />
      )}
    </div>
  );
};

// Export a helper function to dispatch sync progress updates
export const dispatchSyncProgress = (progress: SyncProgressData | null) => {
  window.dispatchEvent(new CustomEvent('sync:progress', { detail: progress }));
};

// Mini variant for header/compact areas
export interface MiniSyncIndicatorProps {
  isSyncing: boolean;
  channelType?: ChannelType;
  progress?: number;
  className?: string;
  onClick?: () => void;
}

export const MiniSyncIndicator: React.FC<MiniSyncIndicatorProps> = ({
  isSyncing,
  channelType,
  progress,
  className,
  onClick,
}) => {
  if (!isSyncing) {
    return null;
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors',
        'bg-primary/10 text-primary hover:bg-primary/20',
        className
      )}
    >
      <span className="animate-spin text-sm" style={{ animationDuration: '1.5s' }}>
        {'\u21BB'}
      </span>
      <span className="text-xs font-medium">
        Syncing{channelType && ` to ${channelType}`}
        {progress !== undefined && ` (${progress}%)`}
      </span>
    </button>
  );
};

export default LiveSyncIndicator;
