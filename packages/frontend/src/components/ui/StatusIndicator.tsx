import React from 'react';
import { cn } from '../../lib/utils';

export interface StatusIndicatorProps {
  status: 'online' | 'offline' | 'syncing' | 'error' | 'idle' | 'processing';
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
  label?: string;
  className?: string;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  status,
  size = 'md',
  pulse = true,
  label,
  className,
}) => {
  const statusColors = {
    online: 'bg-success',
    offline: 'bg-text-muted',
    syncing: 'bg-warning',
    error: 'bg-error',
    idle: 'bg-bronze-400',
    processing: 'bg-primary',
  };

  const sizes = {
    sm: 'w-2 h-2',
    md: 'w-2.5 h-2.5',
    lg: 'w-3 h-3',
  };

  const shouldPulse = pulse && ['online', 'syncing', 'processing'].includes(status);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="relative flex">
        {shouldPulse && (
          <span
            className={cn(
              'absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping',
              statusColors[status]
            )}
            style={{ animationDuration: '2s' }}
          />
        )}
        <span
          className={cn('relative inline-flex rounded-full', statusColors[status], sizes[size])}
        />
      </span>
      {label && <span className="text-sm text-text-muted">{label}</span>}
    </div>
  );
};

// Live indicator with text
export interface LiveIndicatorProps {
  isLive: boolean;
  className?: string;
}

export const LiveIndicator: React.FC<LiveIndicatorProps> = ({ isLive, className }) => {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
        isLive ? 'bg-success/10 text-success' : 'bg-bronze-100 text-text-muted',
        className
      )}
    >
      <StatusIndicator status={isLive ? 'online' : 'offline'} size="sm" pulse={isLive} />
      {isLive ? 'Live' : 'Offline'}
    </div>
  );
};

// Connection status indicator
export interface ConnectionStatusProps {
  connected: boolean;
  reconnecting?: boolean;
  className?: string;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  connected,
  reconnecting = false,
  className,
}) => {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <StatusIndicator
        status={reconnecting ? 'syncing' : connected ? 'online' : 'offline'}
        size="sm"
      />
      <span className="text-xs text-text-muted">
        {reconnecting ? 'Reconnecting...' : connected ? 'Connected' : 'Disconnected'}
      </span>
    </div>
  );
};
