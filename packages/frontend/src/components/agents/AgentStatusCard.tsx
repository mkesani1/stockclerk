import React, { useState } from 'react';
import { cn, formatRelativeTime, formatNumber } from '../../lib/utils';
import { StatusIndicator } from '../ui/StatusIndicator';
import type { AgentType } from '../../types';

export type AgentStatus = 'active' | 'idle' | 'error' | 'disabled';

export interface AgentStatusCardProps {
  id: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  lastAction: string | null;
  jobsProcessed: number;
  lastActionDescription?: string;
  className?: string;
  onClick?: () => void;
}

// Agent icons mapping
const agentIcons: Record<AgentType, string> = {
  watcher: '\u25C9', // Circle with dot (Watcher)
  sync: '\u21BB',    // Clockwise rotation arrow (Sync)
  guardian: '\u2B21', // Hexagon (Guardian)
  alert: '\u2691',   // Flag (Alert)
};

// Status to StatusIndicator status mapping
const statusMap: Record<AgentStatus, { indicatorStatus: 'online' | 'idle' | 'error' | 'offline'; label: string; bgClass: string }> = {
  active: { indicatorStatus: 'online', label: 'Active', bgClass: 'bg-success/10 border-success/20' },
  idle: { indicatorStatus: 'idle', label: 'Idle', bgClass: 'bg-warning/10 border-warning/20' },
  error: { indicatorStatus: 'error', label: 'Error', bgClass: 'bg-error/10 border-error/20' },
  disabled: { indicatorStatus: 'offline', label: 'Disabled', bgClass: 'bg-bronze-100 border-bronze-200' },
};

export const AgentStatusCard: React.FC<AgentStatusCardProps> = ({
  name,
  type,
  status,
  lastAction,
  jobsProcessed,
  lastActionDescription,
  className,
  onClick,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const statusConfig = statusMap[status];
  const icon = agentIcons[type];

  return (
    <div
      className={cn(
        'relative flex items-start gap-4 p-4 rounded-xl border transition-all duration-200',
        'bg-white hover:shadow-soft cursor-pointer',
        status === 'active' && 'ring-1 ring-success/30',
        className
      )}
      onClick={onClick}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick?.();
        }
      }}
    >
      {/* Agent Icon */}
      <div
        className={cn(
          'w-12 h-12 rounded-xl flex items-center justify-center text-2xl font-mono shrink-0 border',
          statusConfig.bgClass
        )}
      >
        <span
          className={cn(
            status === 'active' && 'animate-pulse',
            status === 'active' && 'text-success',
            status === 'idle' && 'text-warning',
            status === 'error' && 'text-error',
            status === 'disabled' && 'text-text-muted'
          )}
        >
          {icon}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h4 className="font-semibold text-text truncate">{name}</h4>
          <StatusIndicator
            status={statusConfig.indicatorStatus}
            size="sm"
            pulse={status === 'active'}
          />
        </div>

        <p className="text-xs text-text-muted mb-2">
          {formatNumber(jobsProcessed)} jobs processed
        </p>

        {lastAction && (
          <p className="text-xs text-text-muted truncate">
            Last: {formatRelativeTime(lastAction)}
          </p>
        )}
      </div>

      {/* Status Badge */}
      <div
        className={cn(
          'absolute top-3 right-3 px-2 py-0.5 rounded-full text-xs font-medium',
          status === 'active' && 'bg-success/10 text-success',
          status === 'idle' && 'bg-warning/10 text-warning',
          status === 'error' && 'bg-error/10 text-error',
          status === 'disabled' && 'bg-bronze-100 text-text-muted'
        )}
      >
        {statusConfig.label}
      </div>

      {/* Tooltip */}
      {showTooltip && (
        <div
          className={cn(
            'absolute left-0 right-0 -bottom-2 translate-y-full z-10',
            'bg-text text-white text-xs rounded-lg p-3 shadow-large',
            'animate-fade-in'
          )}
        >
          <div className="space-y-1">
            <p>
              <span className="text-bronze-300">Type:</span> {type.charAt(0).toUpperCase() + type.slice(1)} Agent
            </p>
            <p>
              <span className="text-bronze-300">Status:</span> {statusConfig.label}
            </p>
            <p>
              <span className="text-bronze-300">Jobs:</span> {formatNumber(jobsProcessed)}
            </p>
            {lastActionDescription && (
              <p>
                <span className="text-bronze-300">Last Action:</span> {lastActionDescription}
              </p>
            )}
          </div>
          {/* Tooltip arrow */}
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-text rotate-45" />
        </div>
      )}
    </div>
  );
};

export default AgentStatusCard;
