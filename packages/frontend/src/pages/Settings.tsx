import React, { useState } from 'react';
import { Header } from '../components/layout/Header';
import { PageWrapper, PageHeader } from '../components/layout/Layout';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Toggle } from '../components/ui/Toggle';
import { Badge } from '../components/ui/Badge';
import { cn } from '../lib/utils';
import { useAuth } from '../hooks/useAuth';

export const Settings: React.FC = () => {
  const { user, updateUser, updateSettings } = useAuth();
  const [activeTab, setActiveTab] = useState<'profile' | 'alerts' | 'sync' | 'notifications'>('profile');
  const [isSaving, setIsSaving] = useState(false);

  // Form states
  const [name, setName] = useState(user?.name ?? '');
  const [businessName, setBusinessName] = useState(user?.businessName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [lowStockThreshold, setLowStockThreshold] = useState(user?.settings.lowStockThreshold ?? 10);
  const [defaultBufferStock, setDefaultBufferStock] = useState(user?.settings.defaultBufferStock ?? 5);
  const [syncInterval, setSyncInterval] = useState(user?.settings.syncInterval ?? 5);
  const [notificationsEnabled, setNotificationsEnabled] = useState(user?.settings.notificationsEnabled ?? true);
  const [emailAlerts, setEmailAlerts] = useState(user?.settings.emailAlerts ?? true);

  const handleSaveProfile = async () => {
    setIsSaving(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    updateUser({ name, businessName, email });
    setIsSaving(false);
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    updateSettings({
      lowStockThreshold,
      defaultBufferStock,
      syncInterval,
      notificationsEnabled,
      emailAlerts,
    });
    setIsSaving(false);
  };

  const tabs = [
    { id: 'profile' as const, label: 'Profile', icon: '👤' },
    { id: 'alerts' as const, label: 'Alert Thresholds', icon: '🔔' },
    { id: 'sync' as const, label: 'Sync Settings', icon: '🔄' },
    { id: 'notifications' as const, label: 'Notifications', icon: '📬' },
  ];

  return (
    <>
      <Header title="Settings" subtitle="Manage your account preferences" />
      <PageWrapper>
        <PageHeader title="Settings" subtitle="Configure your StockClerk preferences" />

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar Navigation */}
          <div className="lg:w-64 flex-shrink-0">
            <Card padding="sm">
              <nav className="space-y-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                      activeTab === tab.id
                        ? 'bg-primary text-white'
                        : 'text-text-muted hover:bg-background-alt hover:text-text'
                    )}
                  >
                    <span>{tab.icon}</span>
                    <span className="font-medium">{tab.label}</span>
                  </button>
                ))}
              </nav>
            </Card>
          </div>

          {/* Content Area */}
          <div className="flex-1">
            {activeTab === 'profile' && (
              <Card>
                <CardHeader>
                  <CardTitle>Profile Settings</CardTitle>
                  <CardDescription>Update your personal and business information</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    {/* Avatar */}
                    <div className="flex items-center gap-6">
                      <div className="w-20 h-20 bg-primary rounded-full flex items-center justify-center">
                        <span className="text-white text-2xl font-semibold">
                          {name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <Button variant="secondary" size="sm">
                          Change Avatar
                        </Button>
                        <p className="text-sm text-text-muted mt-1">
                          JPG, GIF or PNG. Max size 2MB.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Input
                        label="Full Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Enter your name"
                      />
                      <Input
                        label="Email Address"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter your email"
                      />
                    </div>

                    <Input
                      label="Business Name"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="Enter your business name"
                    />

                    <div className="flex justify-end pt-4 border-t border-bronze-200">
                      <Button onClick={handleSaveProfile} loading={isSaving}>
                        Save Changes
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'alerts' && (
              <Card>
                <CardHeader>
                  <CardTitle>Alert Thresholds</CardTitle>
                  <CardDescription>Configure when you receive low stock alerts</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    <div className="p-4 rounded-xl bg-background-alt">
                      <h4 className="font-medium text-text mb-2">Low Stock Warning Level</h4>
                      <p className="text-sm text-text-muted mb-4">
                        You&apos;ll receive an alert when product stock falls below this level.
                      </p>
                      <div className="flex items-center gap-4">
                        <Input
                          type="number"
                          value={lowStockThreshold}
                          onChange={(e) => setLowStockThreshold(parseInt(e.target.value, 10))}
                          min={1}
                          max={100}
                          className="w-32"
                        />
                        <span className="text-text-muted">units</span>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-background-alt">
                      <h4 className="font-medium text-text mb-2">Default Buffer Stock</h4>
                      <p className="text-sm text-text-muted mb-4">
                        Default buffer stock level for new products.
                      </p>
                      <div className="flex items-center gap-4">
                        <Input
                          type="number"
                          value={defaultBufferStock}
                          onChange={(e) => setDefaultBufferStock(parseInt(e.target.value, 10))}
                          min={0}
                          max={50}
                          className="w-32"
                        />
                        <span className="text-text-muted">units</span>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border-2 border-warning/30 bg-warning/5">
                      <div className="flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-warning/10 text-warning">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div>
                          <h4 className="font-medium text-text">Buffer Stock Explained</h4>
                          <p className="text-sm text-text-muted mt-1">
                            Buffer stock is reserved inventory that won&apos;t be shown on sales channels.
                            This helps prevent overselling during sync delays.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end pt-4 border-t border-bronze-200">
                      <Button onClick={handleSaveSettings} loading={isSaving}>
                        Save Changes
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'sync' && (
              <Card>
                <CardHeader>
                  <CardTitle>Sync Settings</CardTitle>
                  <CardDescription>Configure how often your inventory syncs</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    <div className="p-4 rounded-xl bg-background-alt">
                      <h4 className="font-medium text-text mb-2">Sync Interval</h4>
                      <p className="text-sm text-text-muted mb-4">
                        How often to automatically sync inventory across channels.
                      </p>
                      <Select
                        value={syncInterval.toString()}
                        onChange={(value) => setSyncInterval(parseInt(value, 10))}
                        options={[
                          { value: '1', label: 'Every 1 minute' },
                          { value: '5', label: 'Every 5 minutes' },
                          { value: '10', label: 'Every 10 minutes' },
                          { value: '15', label: 'Every 15 minutes' },
                          { value: '30', label: 'Every 30 minutes' },
                          { value: '60', label: 'Every hour' },
                        ]}
                      />
                    </div>

                    <div className="p-4 rounded-xl bg-background-alt">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-text">Real-time Updates</h4>
                          <p className="text-sm text-text-muted mt-1">
                            Receive instant updates via WebSocket connection
                          </p>
                        </div>
                        <Badge variant="success">Active</Badge>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-background-alt">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-text">AI-Powered Sync</h4>
                          <p className="text-sm text-text-muted mt-1">
                            Let AI agents handle inventory synchronization
                          </p>
                        </div>
                        <Badge variant="primary">Enabled</Badge>
                      </div>
                    </div>

                    <div className="flex justify-end pt-4 border-t border-bronze-200">
                      <Button onClick={handleSaveSettings} loading={isSaving}>
                        Save Changes
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'notifications' && (
              <Card>
                <CardHeader>
                  <CardTitle>Notification Preferences</CardTitle>
                  <CardDescription>Choose how you want to receive alerts</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    <Toggle
                      checked={notificationsEnabled}
                      onChange={setNotificationsEnabled}
                      label="Push Notifications"
                      description="Receive browser notifications for important alerts"
                    />

                    <Toggle
                      checked={emailAlerts}
                      onChange={setEmailAlerts}
                      label="Email Alerts"
                      description="Get email notifications for low stock and sync errors"
                    />

                    <div className="pt-4 border-t border-bronze-200">
                      <h4 className="font-medium text-text mb-4">Alert Types</h4>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 rounded-lg bg-background-alt">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-warning/10 text-warning">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                            </div>
                            <span className="text-text">Low Stock Alerts</span>
                          </div>
                          <Badge variant="success" size="sm">Enabled</Badge>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-background-alt">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-error/10 text-error">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </div>
                            <span className="text-text">Sync Errors</span>
                          </div>
                          <Badge variant="success" size="sm">Enabled</Badge>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-background-alt">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-success/10 text-success">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </div>
                            <span className="text-text">Successful Syncs</span>
                          </div>
                          <Badge variant="default" size="sm">Disabled</Badge>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end pt-4 border-t border-bronze-200">
                      <Button onClick={handleSaveSettings} loading={isSaving}>
                        Save Changes
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </PageWrapper>
    </>
  );
};

export default Settings;
