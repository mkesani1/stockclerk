import React, { useState } from 'react';
import { Header } from '../components/layout/Header';
import { PageWrapper, PageHeader, EmptyState } from '../components/layout/Layout';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal, ConfirmDialog } from '../components/ui/Modal';
import { StatusBadge, Badge } from '../components/ui/Badge';
import { StatusIndicator } from '../components/ui/StatusIndicator';
import { Spinner } from '../components/ui/Spinner';
import { cn, formatRelativeTime, formatNumber } from '../lib/utils';
import { useChannels, useConnectChannel, useDisconnectChannel, useSyncChannel } from '../hooks/useApi';
import type { Channel, ChannelType } from '../types';

// Channel configurations
const channelConfig: Record<ChannelType, {
  name: string;
  icon: string;
  description: string;
  color: string;
  bgColor: string;
}> = {
  eposnow: {
    name: 'Eposnow',
    icon: String.fromCodePoint(0x25CE),
    description: 'Connect your Eposnow POS system for real-time inventory sync',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
  },
  wix: {
    name: 'Wix',
    icon: String.fromCodePoint(0x25C7),
    description: 'Sync your Wix eCommerce store inventory automatically',
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
  },
  deliveroo: {
    name: 'Deliveroo',
    icon: String.fromCodePoint(0x25B3),
    description: 'Keep your Deliveroo menu stock levels in sync',
    color: 'text-teal-600',
    bgColor: 'bg-teal-50',
  },
};

export const Channels: React.FC = () => {
  const { data: channels, isLoading } = useChannels();
  const connectChannel = useConnectChannel();
  const disconnectChannel = useDisconnectChannel();
  const syncChannel = useSyncChannel();

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [disconnectModalOpen, setDisconnectModalOpen] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [connectingChannel, setConnectingChannel] = useState<ChannelType | null>(null);

  const handleConnect = async (type: ChannelType) => {
    setConnectingChannel(type);
    try {
      await connectChannel.mutateAsync(type);
      setAddModalOpen(false);
    } finally {
      setConnectingChannel(null);
    }
  };

  const handleDisconnect = async () => {
    if (!selectedChannel) return;
    await disconnectChannel.mutateAsync(selectedChannel.id);
    setDisconnectModalOpen(false);
    setSelectedChannel(null);
  };

  const handleSync = async (channelId: string) => {
    await syncChannel.mutateAsync(channelId);
  };

  const connectedChannelTypes = channels?.map((c) => c.type) ?? [];
  const availableChannels = (Object.keys(channelConfig) as ChannelType[]).filter(
    (type) => !connectedChannelTypes.includes(type)
  );

  return (
    <>
      <Header title="Channels" subtitle="Manage your sales channels" />
      <PageWrapper>
        <PageHeader
          title="Connected Channels"
          subtitle={`${channels?.length ?? 0} active channel${channels?.length !== 1 ? 's' : ''}`}
          actions={
            <Button
              onClick={() => setAddModalOpen(true)}
              leftIcon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              }
              disabled={availableChannels.length === 0}
            >
              Add Channel
            </Button>
          }
        />

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" className="text-primary" />
          </div>
        ) : channels && channels.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {channels.map((channel) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                onSync={() => handleSync(channel.id)}
                onDisconnect={() => {
                  setSelectedChannel(channel);
                  setDisconnectModalOpen(true);
                }}
                isSyncing={syncChannel.isPending && syncChannel.variables === channel.id}
              />
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState
              icon={
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              }
              title="No channels connected"
              description="Connect your first sales channel to start syncing inventory."
              action={
                <Button onClick={() => setAddModalOpen(true)}>
                  Connect a Channel
                </Button>
              }
            />
          </Card>
        )}

        {/* Add Channel Modal */}
        <Modal
          isOpen={addModalOpen}
          onClose={() => setAddModalOpen(false)}
          title="Connect a Channel"
          description="Choose a sales channel to connect"
          size="lg"
        >
          <div className="space-y-4">
            {availableChannels.length > 0 ? (
              availableChannels.map((type) => {
                const config = channelConfig[type];
                const isConnecting = connectingChannel === type;

                return (
                  <div
                    key={type}
                    className={cn(
                      'flex items-center gap-4 p-4 rounded-xl border-2 transition-all',
                      isConnecting
                        ? 'border-primary bg-primary/5'
                        : 'border-bronze-200 hover:border-primary/50 cursor-pointer'
                    )}
                    onClick={() => !isConnecting && handleConnect(type)}
                  >
                    <div className={cn('w-14 h-14 rounded-xl flex items-center justify-center text-2xl font-mono', config.bgColor, config.color)}>
                      {config.icon}
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-text">{config.name}</h4>
                      <p className="text-sm text-text-muted">{config.description}</p>
                    </div>
                    {isConnecting ? (
                      <Spinner size="sm" className="text-primary" />
                    ) : (
                      <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="text-center py-8">
                <p className="text-text-muted">All available channels are connected!</p>
              </div>
            )}
          </div>
        </Modal>

        {/* Disconnect Confirmation */}
        <ConfirmDialog
          isOpen={disconnectModalOpen}
          onClose={() => setDisconnectModalOpen(false)}
          onConfirm={handleDisconnect}
          title="Disconnect Channel"
          message={`Are you sure you want to disconnect ${selectedChannel?.name}? This will stop syncing inventory for this channel.`}
          confirmLabel="Disconnect"
          variant="danger"
          loading={disconnectChannel.isPending}
        />
      </PageWrapper>
    </>
  );
};

// Channel Card Component
interface ChannelCardProps {
  channel: Channel;
  onSync: () => void;
  onDisconnect: () => void;
  isSyncing?: boolean;
}

const ChannelCard: React.FC<ChannelCardProps> = ({
  channel,
  onSync,
  onDisconnect,
  isSyncing = false,
}) => {
  const config = channelConfig[channel.type];

  const statusMap = {
    connected: 'online' as const,
    syncing: 'syncing' as const,
    error: 'error' as const,
    disconnected: 'offline' as const,
  };

  return (
    <Card variant="elevated" hover className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center text-2xl font-mono', config.bgColor, config.color)}>
              {config.icon}
            </div>
            <div>
              <CardTitle>{channel.name}</CardTitle>
              <StatusBadge status={statusMap[channel.status]} className="mt-1" />
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-muted">Products</span>
            <span className="font-medium text-text">{formatNumber(channel.productCount)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-muted">Last Sync</span>
            <span className="text-sm text-text">
              {channel.lastSync ? formatRelativeTime(channel.lastSync) : 'Never'}
            </span>
          </div>
          {channel.status === 'syncing' && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-warning/10 text-warning">
              <Spinner size="sm" />
              <span className="text-sm font-medium">Syncing in progress...</span>
            </div>
          )}
          {channel.status === 'error' && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-error/10 text-error">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-sm font-medium">Sync error - check connection</span>
            </div>
          )}
        </div>
      </CardContent>

      <CardFooter>
        <div className="flex items-center gap-2 w-full">
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            onClick={onSync}
            loading={isSyncing}
            leftIcon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            }
          >
            Sync Now
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDisconnect}
            className="text-text-muted hover:text-error"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
};

export default Channels;
