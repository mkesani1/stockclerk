import React, { useState, useCallback, useMemo } from 'react';
import { Header } from '../components/layout/Header';
import { PageWrapper } from '../components/layout/Layout';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { StatusIndicator, ConnectionStatus } from '../components/ui/StatusIndicator';
import { Badge, ChannelBadge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { cn, formatRelativeTime, formatNumber } from '../lib/utils';
import { useDashboardStats, useAgents, useSyncActivity } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { AgentStatusGrid, AgentData } from '../components/agents';
import { SyncActivityFeed, SyncActivityItemData } from '../components/activity';
import { LiveSyncIndicator, MiniSyncIndicator, SyncProgressData } from '../components/sync';
import { StockChangeModal, StockChangeData } from '../components/products';
import type { Agent, SyncActivity, AgentType } from '../types';

export const Dashboard: React.FC = () => {
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: activities, isLoading: activitiesLoading } = useSyncActivity(8);
  const { isConnected, isReconnecting } = useWebSocket();

  // State for sync progress and stock change modal
  const [syncProgress, setSyncProgress] = useState<SyncProgressData | null>(null);
  const [stockChange, setStockChange] = useState<StockChangeData | null>(null);
  const [isStockChangeModalOpen, setIsStockChangeModalOpen] = useState(false);

  // Transform agents data to AgentData format
  const agentGridData: AgentData[] = useMemo(() => {
    if (!agents) return [];
    return agents.map((agent) => ({
      id: agent.id,
      type: agent.type as AgentType,
      name: agent.name,
      status: agent.status === 'processing' ? 'active' : agent.status as 'active' | 'idle' | 'error' | 'disabled',
      lastAction: agent.lastActivity,
      jobsProcessed: agent.tasksCompleted,
      lastActionDescription: `${agent.name} operations`,
    }));
  }, [agents]);

  // Transform activities data to SyncActivityItemData format
  const activityFeedData: SyncActivityItemData[] = useMemo(() => {
    if (!activities) return [];
    return activities.map((activity) => ({
      id: activity.id,
      type: activity.type === 'stock_update' ? 'stock_updated' :
            activity.type === 'product_sync' ? 'sync_completed' :
            activity.type === 'channel_connect' ? 'sync_started' :
            activity.type === 'alert' ? 'alert_triggered' :
            activity.type === 'error' ? 'sync_error' : 'stock_updated',
      timestamp: activity.timestamp,
      productId: activity.productId,
      productName: activity.productName,
      channelType: activity.channelType,
      oldValue: activity.oldValue,
      newValue: activity.newValue,
      message: activity.message,
    }));
  }, [activities]);

  // Handle agent click
  const handleAgentClick = useCallback((agent: AgentData) => {
    console.log('Agent clicked:', agent);
    // Could open a detail modal or navigate to agent details
  }, []);

  // Handle activity click
  const handleActivityClick = useCallback((activity: SyncActivityItemData) => {
    console.log('Activity clicked:', activity);
    // Could navigate to product or show more details
  }, []);

  // Handle stock change modal
  const handleStockChangeAccept = useCallback((productId: string) => {
    console.log('Stock change accepted for:', productId);
    setIsStockChangeModalOpen(false);
    setStockChange(null);
  }, []);

  const handleStockChangeAdjust = useCallback((productId: string, adjustedStock: number) => {
    console.log('Stock adjusted for:', productId, 'to:', adjustedStock);
    setIsStockChangeModalOpen(false);
    setStockChange(null);
  }, []);

  // Demo: Simulate a stock change notification (for testing)
  const simulateStockChange = useCallback(() => {
    setStockChange({
      id: 'sc-1',
      productId: 'prod-1',
      productName: 'Organic Honey',
      sku: 'SKU-001',
      channelType: 'eposnow',
      channelName: 'Eposnow POS',
      previousStock: 45,
      newStock: 38,
      timestamp: new Date().toISOString(),
      reason: 'POS sale recorded',
    });
    setIsStockChangeModalOpen(true);
  }, []);

  return (
    <>
      <Header
        title="Dashboard"
        subtitle="Real-time inventory overview"
        rightContent={
          <div className="flex items-center gap-3">
            <MiniSyncIndicator
              isSyncing={!!syncProgress}
              channelType={syncProgress?.channelType}
              progress={syncProgress?.progress}
              onClick={() => {}}
            />
            <ConnectionStatus connected={isConnected} reconnecting={isReconnecting} />
          </div>
        }
      />

      {/* Live Sync Progress (when syncing) */}
      <LiveSyncIndicator syncProgress={syncProgress} position="inline" className="mx-6 mb-4" />

      <PageWrapper>
        {/* Hero Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            title="Total Products"
            value={stats?.totalProducts ?? 0}
            loading={statsLoading}
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            }
            trend={{ value: 12, isPositive: true }}
          />
          <StatCard
            title="Synced Today"
            value={stats?.syncedToday ?? 0}
            loading={statsLoading}
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            }
            trend={{ value: 8, isPositive: true }}
          />
          <StatCard
            title="Active Channels"
            value={stats?.activeChannels ?? 0}
            loading={statsLoading}
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
          />
          <StatCard
            title="Alerts"
            value={stats?.alertsCount ?? 0}
            loading={statsLoading}
            variant={stats?.alertsCount && stats.alertsCount > 0 ? 'warning' : 'default'}
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            }
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* AI Agents Status Grid */}
          <div className="lg:col-span-2">
            <Card>
              <CardContent>
                <AgentStatusGrid
                  agents={agentGridData}
                  isLoading={agentsLoading}
                  isConnected={isConnected}
                  onAgentClick={handleAgentClick}
                />
              </CardContent>
            </Card>
          </div>

          {/* Sync Activity Feed */}
          <div>
            <Card className="h-full" style={{ maxHeight: '500px' }}>
              <CardContent className="h-full flex flex-col">
                <SyncActivityFeed
                  activities={activityFeedData}
                  isLoading={activitiesLoading}
                  maxItems={20}
                  autoScroll={true}
                  showFilters={false}
                  onActivityClick={handleActivityClick}
                  className="flex-1 min-h-0"
                />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <QuickAction
                  icon={
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  }
                  label="Add Product"
                  href="/products?action=add"
                />
                <QuickAction
                  icon={
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  }
                  label="Force Sync"
                  href="/sync"
                />
                <QuickAction
                  icon={
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  }
                  label="Add Channel"
                  href="/channels?action=add"
                />
                <QuickAction
                  icon={
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  }
                  label="View Reports"
                />
                <QuickAction
                  icon={
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                  }
                  label="Test Alert"
                  onClick={simulateStockChange}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </PageWrapper>

      {/* Stock Change Modal */}
      <StockChangeModal
        isOpen={isStockChangeModalOpen}
        onClose={() => setIsStockChangeModalOpen(false)}
        stockChange={stockChange}
        onAccept={handleStockChangeAccept}
        onAdjust={handleStockChangeAdjust}
      />
    </>
  );
};

// Stat Card Component
interface StatCardProps {
  title: string;
  value: number;
  loading?: boolean;
  icon: React.ReactNode;
  trend?: { value: number; isPositive: boolean };
  variant?: 'default' | 'warning' | 'error';
}

const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  loading,
  icon,
  trend,
  variant = 'default',
}) => {
  const variantStyles = {
    default: 'bg-primary/10 text-primary',
    warning: 'bg-warning/10 text-warning',
    error: 'bg-error/10 text-error',
  };

  return (
    <Card hover variant="elevated">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-text-muted">{title}</p>
          {loading ? (
            <div className="h-8 w-16 skeleton mt-1" />
          ) : (
            <p className="text-2xl font-bold text-text mt-1">{formatNumber(value)}</p>
          )}
          {trend && (
            <div className="flex items-center gap-1 mt-2">
              <span
                className={cn(
                  'text-xs font-medium',
                  trend.isPositive ? 'text-success' : 'text-error'
                )}
              >
                {trend.isPositive ? '+' : '-'}{trend.value}%
              </span>
              <span className="text-xs text-text-muted">vs last week</span>
            </div>
          )}
        </div>
        <div className={cn('p-3 rounded-xl', variantStyles[variant])}>
          {icon}
        </div>
      </div>
    </Card>
  );
};

// Quick Action Component
const QuickAction: React.FC<{
  icon: React.ReactNode;
  label: string;
  href?: string;
  onClick?: () => void;
}> = ({ icon, label, href, onClick }) => {
  const handleClick = () => {
    if (href) {
      window.location.href = href;
    } else if (onClick) {
      onClick();
    }
  };

  return (
    <button
      onClick={handleClick}
      className="flex flex-col items-center gap-2 p-4 rounded-xl bg-background-alt hover:bg-bronze-200 transition-colors group"
    >
      <div className="p-3 rounded-xl bg-white text-primary group-hover:bg-primary group-hover:text-white transition-colors">
        {icon}
      </div>
      <span className="text-sm font-medium text-text">{label}</span>
    </button>
  );
};

export default Dashboard;
