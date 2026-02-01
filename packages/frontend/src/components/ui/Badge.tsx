import React from 'react';
import { cn } from '../../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'primary';
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = 'default',
  size = 'md',
  children,
  ...props
}) => {
  const variants = {
    default: 'bg-bronze-100 text-text-muted',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    error: 'bg-error/10 text-error',
    primary: 'bg-primary/10 text-primary',
  };

  const sizes = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-full',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};

// Status Badge with dot indicator
export interface StatusBadgeProps extends Omit<BadgeProps, 'variant'> {
  status: 'online' | 'offline' | 'syncing' | 'error' | 'idle';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  className,
  children,
  ...props
}) => {
  const statusConfig = {
    online: { variant: 'success' as const, label: 'Online', dotClass: 'bg-success' },
    offline: { variant: 'default' as const, label: 'Offline', dotClass: 'bg-text-muted' },
    syncing: { variant: 'warning' as const, label: 'Syncing', dotClass: 'bg-warning' },
    error: { variant: 'error' as const, label: 'Error', dotClass: 'bg-error' },
    idle: { variant: 'default' as const, label: 'Idle', dotClass: 'bg-bronze-400' },
  };

  const config = statusConfig[status];

  return (
    <Badge variant={config.variant} className={cn('gap-1.5', className)} {...props}>
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          config.dotClass,
          status === 'syncing' && 'animate-pulse'
        )}
      />
      {children || config.label}
    </Badge>
  );
};

// Channel Badge
export interface ChannelBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  channel: 'eposnow' | 'wix' | 'deliveroo';
  showIcon?: boolean;
}

export const ChannelBadge: React.FC<ChannelBadgeProps> = ({
  channel,
  showIcon = true,
  className,
  ...props
}) => {
  const channelConfig = {
    eposnow: { icon: String.fromCodePoint(0x25CE), label: 'Eposnow', color: 'bg-blue-50 text-blue-700' },
    wix: { icon: String.fromCodePoint(0x25C7), label: 'Wix', color: 'bg-purple-50 text-purple-700' },
    deliveroo: { icon: String.fromCodePoint(0x25B3), label: 'Deliveroo', color: 'bg-teal-50 text-teal-700' },
  };

  const config = channelConfig[channel];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-sm font-medium px-2.5 py-1 rounded-full',
        config.color,
        className
      )}
      {...props}
    >
      {showIcon && <span className="font-mono">{config.icon}</span>}
      {config.label}
    </span>
  );
};
