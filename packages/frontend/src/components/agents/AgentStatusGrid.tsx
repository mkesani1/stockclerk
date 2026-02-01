import React, { useEffect, useState, useCallback } from 'react';
import { cn } from '../../lib/utils';
import { AgentStatusCard, AgentStatus } from './AgentStatusCard';
import { Spinner } from '../ui/Spinner';
import { StatusIndicator } from '../ui/StatusIndicator';
import type { AgentType } from '../../types';

export interface AgentData {
  id: string;
  type: AgentType;
  name: string;
  status: AgentStatus;
  lastAction: string | null;
  jobsProcessed: number;
  lastActionDescription?: string;
}

export interface AgentStatusGridProps {
  agents?: AgentData[];
  isLoading?: boolean;
  isConnected?: boolean;
  onAgentClick?: (agent: AgentData) => void;
  className?: string;
}

// Default agent configuration
const defaultAgents: AgentData[] = [
  {
    id: 'watcher-1',
    type: 'watcher',
    name: 'Stock Watcher',
    status: 'active',
    lastAction: null,
    jobsProcessed: 0,
    lastActionDescription: 'Monitoring stock levels',
  },
  {
    id: 'sync-1',
    type: 'sync',
    name: 'Sync Engine',
    status: 'idle',
    lastAction: null,
    jobsProcessed: 0,
    lastActionDescription: 'Waiting for sync tasks',
  },
  {
    id: 'guardian-1',
    type: 'guardian',
    name: 'Stock Guardian',
    status: 'active',
    lastAction: null,
    jobsProcessed: 0,
    lastActionDescription: 'Protecting stock integrity',
  },
  {
    id: 'alert-1',
    type: 'alert',
    name: 'Alert Manager',
    status: 'idle',
    lastAction: null,
    jobsProcessed: 0,
    lastActionDescription: 'Monitoring for alerts',
  },
];

export const AgentStatusGrid: React.FC<AgentStatusGridProps> = ({
  agents: initialAgents,
  isLoading = false,
  isConnected = true,
  onAgentClick,
  className,
}) => {
  const [agents, setAgents] = useState<AgentData[]>(initialAgents || defaultAgents);

  // Update agents when prop changes
  useEffect(() => {
    if (initialAgents) {
      setAgents(initialAgents);
    }
  }, [initialAgents]);

  // Handler for WebSocket agent status updates
  const handleAgentStatusUpdate = useCallback((payload: {
    agentId: string;
    status: AgentStatus;
    lastAction?: string;
    jobsProcessed?: number;
    lastActionDescription?: string;
  }) => {
    setAgents((prevAgents) =>
      prevAgents.map((agent) =>
        agent.id === payload.agentId
          ? {
              ...agent,
              status: payload.status,
              lastAction: payload.lastAction || agent.lastAction,
              jobsProcessed: payload.jobsProcessed ?? agent.jobsProcessed,
              lastActionDescription: payload.lastActionDescription || agent.lastActionDescription,
            }
          : agent
      )
    );
  }, []);

  // Expose the update handler for parent components to use with WebSocket
  useEffect(() => {
    // This could be connected to a WebSocket event listener
    // For now, we expose the handler through a custom event
    const handleEvent = (event: CustomEvent) => {
      handleAgentStatusUpdate(event.detail);
    };

    window.addEventListener('agent:status' as any, handleEvent);
    return () => {
      window.removeEventListener('agent:status' as any, handleEvent);
    };
  }, [handleAgentStatusUpdate]);

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <Spinner size="lg" className="text-primary" />
      </div>
    );
  }

  const activeCount = agents.filter((a) => a.status === 'active').length;
  const errorCount = agents.filter((a) => a.status === 'error').length;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header with connection status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-text">AI Agents</h3>
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <span className="text-success font-medium">{activeCount}</span> active
            {errorCount > 0 && (
              <>
                <span className="text-bronze-300">|</span>
                <span className="text-error font-medium">{errorCount}</span> error
              </>
            )}
          </div>
        </div>
        <StatusIndicator
          status={isConnected ? 'online' : 'offline'}
          label={isConnected ? 'Real-time' : 'Disconnected'}
          size="sm"
        />
      </div>

      {/* 2x2 Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {agents.map((agent) => (
          <AgentStatusCard
            key={agent.id}
            id={agent.id}
            type={agent.type}
            name={agent.name}
            status={agent.status}
            lastAction={agent.lastAction}
            jobsProcessed={agent.jobsProcessed}
            lastActionDescription={agent.lastActionDescription}
            onClick={() => onAgentClick?.(agent)}
          />
        ))}
      </div>

      {/* Connection warning */}
      {!isConnected && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-warning/10 border border-warning/20 text-sm text-warning">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>Real-time updates unavailable. Status may be outdated.</span>
        </div>
      )}
    </div>
  );
};

// Export a helper function to dispatch agent status updates
export const dispatchAgentStatusUpdate = (payload: {
  agentId: string;
  status: AgentStatus;
  lastAction?: string;
  jobsProcessed?: number;
  lastActionDescription?: string;
}) => {
  window.dispatchEvent(new CustomEvent('agent:status', { detail: payload }));
};

export default AgentStatusGrid;
