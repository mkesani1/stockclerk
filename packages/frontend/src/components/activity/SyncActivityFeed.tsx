import React, { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '../../lib/utils';
import { SyncActivityItem, SyncActivityItemData, SyncEventType } from './SyncActivityItem';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';

export interface SyncActivityFeedProps {
  activities?: SyncActivityItemData[];
  isLoading?: boolean;
  maxItems?: number;
  autoScroll?: boolean;
  showFilters?: boolean;
  onActivityClick?: (activity: SyncActivityItemData) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  className?: string;
}

// Filter options
const filterOptions: { value: SyncEventType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'stock_updated', label: 'Stock Updates' },
  { value: 'sync_started', label: 'Sync Started' },
  { value: 'sync_completed', label: 'Completed' },
  { value: 'sync_error', label: 'Errors' },
  { value: 'alert_triggered', label: 'Alerts' },
];

export const SyncActivityFeed: React.FC<SyncActivityFeedProps> = ({
  activities: initialActivities = [],
  isLoading = false,
  maxItems = 50,
  autoScroll = true,
  showFilters = true,
  onActivityClick,
  onLoadMore,
  hasMore = false,
  className,
}) => {
  const [activities, setActivities] = useState<SyncActivityItemData[]>(initialActivities);
  const [filter, setFilter] = useState<SyncEventType | 'all'>('all');
  const [isPaused, setIsPaused] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // Update activities when prop changes
  useEffect(() => {
    setActivities(initialActivities);
  }, [initialActivities]);

  // Handler for new activity events (from WebSocket)
  const handleNewActivity = useCallback(
    (newActivity: SyncActivityItemData) => {
      if (isPaused) return;

      setActivities((prev) => {
        // Prevent duplicates
        if (prev.some((a) => a.id === newActivity.id)) {
          return prev;
        }

        // Add new activity at the top and limit total items
        const updated = [newActivity, ...prev].slice(0, maxItems);
        return updated;
      });
    },
    [isPaused, maxItems]
  );

  // Listen for new activity events
  useEffect(() => {
    const handleEvent = (event: CustomEvent) => {
      handleNewActivity(event.detail);
    };

    window.addEventListener('activity:new' as any, handleEvent);
    return () => {
      window.removeEventListener('activity:new' as any, handleEvent);
    };
  }, [handleNewActivity]);

  // Auto-scroll to top when new activities arrive (if enabled and at top)
  useEffect(() => {
    if (autoScroll && !isPaused && isAtBottomRef.current && feedRef.current) {
      feedRef.current.scrollTop = 0;
    }
  }, [activities, autoScroll, isPaused]);

  // Track scroll position to determine if user is at top
  const handleScroll = useCallback(() => {
    if (feedRef.current) {
      isAtBottomRef.current = feedRef.current.scrollTop < 50;
    }
  }, []);

  // Filter activities
  const filteredActivities =
    filter === 'all'
      ? activities
      : activities.filter((a) => a.type === filter);

  const newActivityCount = activities.length - initialActivities.length;

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header with Filters */}
      {showFilters && (
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-text">Activity Feed</h3>
            {newActivityCount > 0 && (
              <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs font-medium rounded-full">
                +{newActivityCount} new
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Filter Buttons */}
            <div className="flex items-center gap-1 flex-wrap">
              {filterOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setFilter(option.value)}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium rounded-full transition-colors',
                    filter === option.value
                      ? 'bg-primary text-white'
                      : 'bg-bronze-100 text-text-muted hover:bg-bronze-200'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {/* Pause/Resume Button */}
            <button
              onClick={() => setIsPaused(!isPaused)}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-full transition-colors flex items-center gap-1',
                isPaused
                  ? 'bg-warning/10 text-warning'
                  : 'bg-bronze-100 text-text-muted hover:bg-bronze-200'
              )}
              title={isPaused ? 'Resume live updates' : 'Pause live updates'}
            >
              {isPaused ? (
                <>
                  <span>{'\u25B6'}</span> Resume
                </>
              ) : (
                <>
                  <span>{'\u23F8'}</span> Pause
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Activity List */}
      <div
        ref={feedRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto space-y-2 min-h-0"
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" className="text-primary" />
          </div>
        ) : filteredActivities.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-bronze-100 flex items-center justify-center mb-3">
              <span className="text-2xl text-bronze-400">{'\u23F3'}</span>
            </div>
            <p className="text-text-muted text-sm">
              {filter === 'all'
                ? 'No activity yet'
                : `No ${filterOptions.find((f) => f.value === filter)?.label.toLowerCase()} activity`}
            </p>
          </div>
        ) : (
          <>
            {filteredActivities.map((activity, index) => (
              <div
                key={activity.id}
                className={cn(
                  'animate-fade-in',
                  index < newActivityCount && 'animate-slide-down'
                )}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <SyncActivityItem
                  activity={activity}
                  onClick={() => onActivityClick?.(activity)}
                />
              </div>
            ))}

            {/* Load More Button */}
            {hasMore && onLoadMore && (
              <div className="pt-4 pb-2 text-center">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onLoadMore}
                >
                  Load More
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Paused Indicator */}
      {isPaused && activities.length > 0 && (
        <div className="mt-2 flex items-center justify-center gap-2 py-2 bg-warning/10 rounded-lg text-sm text-warning">
          <span>{'\u23F8'}</span>
          <span>Live updates paused</span>
          <button
            onClick={() => setIsPaused(false)}
            className="underline hover:no-underline font-medium"
          >
            Resume
          </button>
        </div>
      )}
    </div>
  );
};

// Export a helper function to dispatch new activity events
export const dispatchNewActivity = (activity: SyncActivityItemData) => {
  window.dispatchEvent(new CustomEvent('activity:new', { detail: activity }));
};

export default SyncActivityFeed;
