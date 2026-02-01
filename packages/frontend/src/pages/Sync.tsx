import React, { useState, useCallback, useMemo } from 'react';
import { Header } from '../components/layout/Header';
import { PageWrapper, PageHeader } from '../components/layout/Layout';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Input } from '../components/ui/Input';
import { Badge, ChannelBadge, StatusBadge } from '../components/ui/Badge';
import { StatusIndicator, ConnectionStatus } from '../components/ui/StatusIndicator';
import { Spinner } from '../components/ui/Spinner';
import { Modal, ConfirmDialog } from '../components/ui/Modal';
import { cn, formatRelativeTime, formatDate, formatNumber } from '../lib/utils';
import { useChannels, useSyncChannel, useSyncActivity } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { SyncActivityFeed, SyncActivityItemData, SyncEventType } from '../components/activity';
import { LiveSyncIndicator, SyncProgressData } from '../components/sync';
import type { Channel, ChannelType } from '../types';

// Reconciliation status type
interface ReconciliationStatus {
  channelType: ChannelType;
  channelName: string;
  lastReconciled: string | null;
  status: 'synced' | 'pending' | 'conflict' | 'never';
  productsTotal: number;
  productsSynced: number;
  productsWithConflicts: number;
}

export const Sync: React.FC = () => {
  const { data: channels, isLoading: channelsLoading } = useChannels();
  const { data: activities, isLoading: activitiesLoading } = useSyncActivity(50);
  const { mutate: syncChannel, isPending: isSyncing } = useSyncChannel();
  const { isConnected, isReconnecting } = useWebSocket();

  // State
  const [syncProgress, setSyncProgress] = useState<SyncProgressData | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string>('all');
  const [selectedEventType, setSelectedEventType] = useState<string>('all');
  const [selectedDateRange, setSelectedDateRange] = useState<string>('7d');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [confirmSyncChannel, setConfirmSyncChannel] = useState<Channel | null>(null);
  const [showReconcileModal, setShowReconcileModal] = useState(false);

  // Mock reconciliation status data
  const reconciliationStatus: ReconciliationStatus[] = useMemo(() => {
    if (!channels) return [];
    return channels.map((channel) => ({
      channelType: channel.type,
      channelName: channel.name,
      lastReconciled: channel.lastSync,
      status: channel.status === 'connected' ? 'synced' :
              channel.status === 'syncing' ? 'pending' :
              channel.status === 'error' ? 'conflict' : 'never',
      productsTotal: channel.productCount,
      productsSynced: channel.productCount - Math.floor(Math.random() * 5),
      productsWithConflicts: channel.status === 'error' ? Math.floor(Math.random() * 3) + 1 : 0,
    }));
  }, [channels]);

  // Transform activities data
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

  // Filter activities
  const filteredActivities = useMemo(() => {
    let result = activityFeedData;

    if (selectedChannel !== 'all') {
      result = result.filter((a) => a.channelType === selectedChannel);
    }

    if (selectedEventType !== 'all') {
      result = result.filter((a) => a.type === selectedEventType);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (a) =>
          a.productName?.toLowerCase().includes(query) ||
          a.message?.toLowerCase().includes(query)
      );
    }

    // Date range filter
    const now = new Date();
    let cutoff: Date;
    switch (selectedDateRange) {
      case '1d':
        cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        cutoff = new Date(0);
    }
    result = result.filter((a) => new Date(a.timestamp) >= cutoff);

    return result;
  }, [activityFeedData, selectedChannel, selectedEventType, selectedDateRange, searchQuery]);

  // Handle manual sync
  const handleManualSync = useCallback((channel: Channel) => {
    setConfirmSyncChannel(channel);
  }, []);

  const confirmManualSync = useCallback(() => {
    if (confirmSyncChannel) {
      // Start mock sync progress
      setSyncProgress({
        channelType: confirmSyncChannel.type,
        channelName: confirmSyncChannel.name,
        progress: 0,
        itemsSynced: 0,
        totalItems: confirmSyncChannel.productCount,
        startedAt: new Date().toISOString(),
      });

      // Simulate progress
      let progress = 0;
      const interval = setInterval(() => {
        progress += 10;
        if (progress >= 100) {
          clearInterval(interval);
          setSyncProgress(null);
        } else {
          setSyncProgress((prev) =>
            prev
              ? {
                  ...prev,
                  progress,
                  itemsSynced: Math.floor((progress / 100) * prev.totalItems),
                  currentProduct: `Product ${Math.floor((progress / 100) * prev.totalItems)}`,
                }
              : null
          );
        }
      }, 500);

      syncChannel(confirmSyncChannel.id);
    }
    setConfirmSyncChannel(null);
  }, [confirmSyncChannel, syncChannel]);

  // Handle sync all
  const handleSyncAll = useCallback(() => {
    console.log('Syncing all channels...');
    // Would trigger sync for all connected channels
  }, []);

  // Channel options for filter
  const channelOptions = useMemo(() => {
    const options = [{ value: 'all', label: 'All Channels' }];
    if (channels) {
      channels.forEach((channel) => {
        options.push({ value: channel.type, label: channel.name });
      });
    }
    return options;
  }, [channels]);

  // Event type options for filter
  const eventTypeOptions = [
    { value: 'all', label: 'All Events' },
    { value: 'stock_updated', label: 'Stock Updates' },
    { value: 'sync_started', label: 'Sync Started' },
    { value: 'sync_completed', label: 'Sync Completed' },
    { value: 'sync_error', label: 'Sync Errors' },
    { value: 'alert_triggered', label: 'Alerts' },
  ];

  // Date range options
  const dateRangeOptions = [
    { value: '1d', label: 'Last 24 hours' },
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: 'all', label: 'All time' },
  ];

  return (
    <>
      <Header
        title="Sync Center"
        subtitle="Manage inventory synchronization across all channels"
        rightContent={
          <ConnectionStatus connected={isConnected} reconnecting={isReconnecting} />
        }
      />

      {/* Live Sync Progress */}
      <LiveSyncIndicator
        syncProgress={syncProgress}
        position="inline"
        className="mx-6 mb-4"
        onCancel={() => setSyncProgress(null)}
      />

      <PageWrapper>
        {/* Top Actions */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-text">Channel Sync Status</h2>
            <p className="text-sm text-text-muted">
              View and manage synchronization for all connected channels
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => setShowReconcileModal(true)}
              leftIcon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              }
            >
              Reconcile
            </Button>
            <Button
              variant="primary"
              onClick={handleSyncAll}
              loading={isSyncing}
              leftIcon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              }
            >
              Sync All
            </Button>
          </div>
        </div>

        {/* Channel Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {channelsLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <div className="h-32 bg-bronze-100 rounded-lg" />
              </Card>
            ))
          ) : (
            channels?.map((channel) => (
              <ChannelSyncCard
                key={channel.id}
                channel={channel}
                reconciliation={reconciliationStatus.find((r) => r.channelType === channel.type)}
                onSync={() => handleManualSync(channel)}
                isSyncing={isSyncing && syncProgress?.channelType === channel.type}
              />
            ))
          )}
        </div>

        {/* Activity History Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <CardTitle>Sync Activity History</CardTitle>
                <CardDescription>
                  {formatNumber(filteredActivities.length)} events found
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-4 mb-6 p-4 bg-background-alt rounded-xl">
              <div className="flex-1 min-w-[200px]">
                <Input
                  placeholder="Search by product or message..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  leftIcon={
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  }
                />
              </div>
              <div className="w-[180px]">
                <Select
                  options={channelOptions}
                  value={selectedChannel}
                  onChange={setSelectedChannel}
                  placeholder="Channel"
                />
              </div>
              <div className="w-[180px]">
                <Select
                  options={eventTypeOptions}
                  value={selectedEventType}
                  onChange={setSelectedEventType}
                  placeholder="Event Type"
                />
              </div>
              <div className="w-[180px]">
                <Select
                  options={dateRangeOptions}
                  value={selectedDateRange}
                  onChange={setSelectedDateRange}
                  placeholder="Date Range"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedChannel('all');
                  setSelectedEventType('all');
                  setSelectedDateRange('7d');
                  setSearchQuery('');
                }}
              >
                Clear Filters
              </Button>
            </div>

            {/* Activity Feed */}
            <div className="max-h-[600px] overflow-y-auto">
              <SyncActivityFeed
                activities={filteredActivities}
                isLoading={activitiesLoading}
                showFilters={false}
                maxItems={100}
              />
            </div>
          </CardContent>
        </Card>
      </PageWrapper>

      {/* Confirm Sync Dialog */}
      <ConfirmDialog
        isOpen={!!confirmSyncChannel}
        onClose={() => setConfirmSyncChannel(null)}
        onConfirm={confirmManualSync}
        title="Confirm Manual Sync"
        message={`Are you sure you want to sync all products with ${confirmSyncChannel?.name}? This will update ${confirmSyncChannel?.productCount} products.`}
        confirmLabel="Start Sync"
        loading={isSyncing}
      />

      {/* Reconciliation Modal */}
      <ReconciliationModal
        isOpen={showReconcileModal}
        onClose={() => setShowReconcileModal(false)}
        reconciliationStatus={reconciliationStatus}
      />
    </>
  );
};

// Channel Sync Card Component
interface ChannelSyncCardProps {
  channel: Channel;
  reconciliation?: ReconciliationStatus;
  onSync: () => void;
  isSyncing: boolean;
}

const ChannelSyncCard: React.FC<ChannelSyncCardProps> = ({
  channel,
  reconciliation,
  onSync,
  isSyncing,
}) => {
  const statusConfig = {
    connected: { label: 'Connected', status: 'online' as const },
    syncing: { label: 'Syncing', status: 'syncing' as const },
    error: { label: 'Error', status: 'error' as const },
    disconnected: { label: 'Disconnected', status: 'offline' as const },
  };

  const config = statusConfig[channel.status];

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <ChannelBadge channel={channel.type} />
          <StatusBadge status={config.status}>{config.label}</StatusBadge>
        </div>
      </div>

      <h4 className="font-semibold text-text mb-1">{channel.name}</h4>
      <p className="text-sm text-text-muted mb-4">
        {formatNumber(channel.productCount)} products
      </p>

      <div className="space-y-2 mb-4">
        <div className="flex justify-between text-sm">
          <span className="text-text-muted">Last Sync</span>
          <span className="text-text">
            {channel.lastSync ? formatRelativeTime(channel.lastSync) : 'Never'}
          </span>
        </div>
        {reconciliation && (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Synced</span>
              <span className="text-text">
                {formatNumber(reconciliation.productsSynced)} / {formatNumber(reconciliation.productsTotal)}
              </span>
            </div>
            {reconciliation.productsWithConflicts > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Conflicts</span>
                <span className="text-error font-medium">
                  {formatNumber(reconciliation.productsWithConflicts)}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        onClick={onSync}
        loading={isSyncing}
        disabled={channel.status === 'disconnected'}
        leftIcon={
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        }
      >
        Sync Now
      </Button>
    </Card>
  );
};

// Reconciliation Modal Component
interface ReconciliationModalProps {
  isOpen: boolean;
  onClose: () => void;
  reconciliationStatus: ReconciliationStatus[];
}

const ReconciliationModal: React.FC<ReconciliationModalProps> = ({
  isOpen,
  onClose,
  reconciliationStatus,
}) => {
  const [selectedChannel, setSelectedChannel] = useState<ChannelType | 'all'>('all');
  const [isReconciling, setIsReconciling] = useState(false);

  const handleReconcile = () => {
    setIsReconciling(true);
    // Simulate reconciliation
    setTimeout(() => {
      setIsReconciling(false);
      onClose();
    }, 2000);
  };

  const filteredStatus =
    selectedChannel === 'all'
      ? reconciliationStatus
      : reconciliationStatus.filter((r) => r.channelType === selectedChannel);

  const totalConflicts = filteredStatus.reduce(
    (sum, r) => sum + r.productsWithConflicts,
    0
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Reconciliation Status"
      description="Review and resolve inventory discrepancies across channels"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isReconciling}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={handleReconcile}
            loading={isReconciling}
            disabled={totalConflicts === 0}
          >
            Reconcile {totalConflicts > 0 ? `(${totalConflicts} conflicts)` : ''}
          </Button>
        </>
      }
    >
      {/* Channel Filter */}
      <div className="mb-4">
        <Select
          label="Filter by Channel"
          options={[
            { value: 'all', label: 'All Channels' },
            ...reconciliationStatus.map((r) => ({
              value: r.channelType,
              label: r.channelName,
            })),
          ]}
          value={selectedChannel}
          onChange={(val) => setSelectedChannel(val as ChannelType | 'all')}
        />
      </div>

      {/* Status Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="p-4 bg-success/10 rounded-xl text-center">
          <p className="text-2xl font-bold text-success">
            {formatNumber(
              filteredStatus.reduce((sum, r) => sum + r.productsSynced, 0)
            )}
          </p>
          <p className="text-sm text-text-muted">Synced</p>
        </div>
        <div className="p-4 bg-warning/10 rounded-xl text-center">
          <p className="text-2xl font-bold text-warning">
            {formatNumber(
              filteredStatus.reduce(
                (sum, r) => sum + (r.productsTotal - r.productsSynced),
                0
              )
            )}
          </p>
          <p className="text-sm text-text-muted">Pending</p>
        </div>
        <div className="p-4 bg-error/10 rounded-xl text-center">
          <p className="text-2xl font-bold text-error">
            {formatNumber(totalConflicts)}
          </p>
          <p className="text-sm text-text-muted">Conflicts</p>
        </div>
      </div>

      {/* Channel Details */}
      <div className="space-y-4">
        {filteredStatus.map((status) => (
          <div
            key={status.channelType}
            className="flex items-center justify-between p-4 bg-background-alt rounded-xl"
          >
            <div className="flex items-center gap-3">
              <ChannelBadge channel={status.channelType} />
              <div>
                <p className="font-medium text-text">{status.channelName}</p>
                <p className="text-sm text-text-muted">
                  Last reconciled: {status.lastReconciled ? formatRelativeTime(status.lastReconciled) : 'Never'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium text-text">
                  {formatNumber(status.productsSynced)} / {formatNumber(status.productsTotal)}
                </p>
                {status.productsWithConflicts > 0 && (
                  <p className="text-xs text-error">
                    {status.productsWithConflicts} conflicts
                  </p>
                )}
              </div>
              <StatusIndicator
                status={
                  status.status === 'synced'
                    ? 'online'
                    : status.status === 'pending'
                    ? 'syncing'
                    : status.status === 'conflict'
                    ? 'error'
                    : 'offline'
                }
                size="lg"
              />
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
};

export default Sync;
