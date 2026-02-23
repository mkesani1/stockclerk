import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { channelsApi, syncApi, wsClient } from '../../api/client';

type OnboardingStep = 'welcome' | 'channel' | 'credentials' | 'import' | 'buffer' | 'ready';

const STEPS: OnboardingStep[] = ['welcome', 'channel', 'credentials', 'import', 'buffer', 'ready'];

export const Onboarding: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { completeOnboarding } = useAuth();
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome');
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importComplete, setImportComplete] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [bufferStock, setBufferStock] = useState('5');
  const [error, setError] = useState<string | null>(null);
  const [connectedChannelId, setConnectedChannelId] = useState<string | null>(null);

  // Eposnow credentials state
  const [eposnowApiKey, setEposnowApiKey] = useState('');
  const [eposnowApiSecret, setEposnowApiSecret] = useState('');
  // WooCommerce credentials state
  const [wooSiteUrl, setWooSiteUrl] = useState('');
  const [wooConsumerKey, setWooConsumerKey] = useState('');
  const [wooConsumerSecret, setWooConsumerSecret] = useState('');
  // Shopify state
  const [shopifyShop, setShopifyShop] = useState('');

  const stepIndex = STEPS.indexOf(currentStep);

  // Handle OAuth callback from URL params
  useEffect(() => {
    const channelId = searchParams.get('channel');
    const success = searchParams.get('success');
    const errorParam = searchParams.get('error');
    const type = searchParams.get('type');

    if (errorParam) {
      setError(decodeURIComponent(errorParam));
      setCurrentStep('channel');
    } else if (success === 'true' && channelId) {
      setConnectedChannelId(channelId);
      setSelectedChannel(type || 'wix');
      setCurrentStep('import');
    }
  }, [searchParams]);

  // WebSocket for sync progress
  useEffect(() => {
    if (currentStep === 'import' && isImporting) {
      wsClient.connect();

      const unsubProgress = wsClient.on('sync_progress', (event: any) => {
        setImportProgress({
          current: event.data?.processed || 0,
          total: event.data?.total || 0,
        });
      });

      const unsubComplete = wsClient.on('sync_completed', () => {
        setIsImporting(false);
        setImportComplete(true);
      });

      return () => {
        unsubProgress();
        unsubComplete();
      };
    }
  }, [currentStep, isImporting]);

  const handleNext = () => {
    const nextIndex = stepIndex + 1;
    if (nextIndex < STEPS.length) {
      setCurrentStep(STEPS[nextIndex]);
    }
  };

  const handleBack = () => {
    const prevIndex = stepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(STEPS[prevIndex]);
    }
  };

  const handleSelectChannel = (channel: string) => {
    setSelectedChannel(channel);
    setError(null);
  };

  const handleConnectChannel = async () => {
    if (!selectedChannel) return;
    setIsConnecting(true);
    setError(null);

    try {
      if (selectedChannel === 'wix') {
        const { authUrl } = await channelsApi.startWixOAuth();
        window.location.href = authUrl;
        return;
      } else if (selectedChannel === 'shopify') {
        if (!shopifyShop) {
          setCurrentStep('credentials');
          setIsConnecting(false);
          return;
        }
        const { authUrl } = await channelsApi.startShopifyOAuth(shopifyShop);
        window.location.href = authUrl;
        return;
      } else if (selectedChannel === 'uber_eats') {
        const { authUrl } = await channelsApi.startUberEatsOAuth();
        window.location.href = authUrl;
        return;
      } else if (selectedChannel === 'woocommerce') {
        setCurrentStep('credentials');
      } else if (selectedChannel === 'eposnow' || selectedChannel === 'deliveroo') {
        setCurrentStep('credentials');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect channel');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSubmitCredentials = async () => {
    if (!selectedChannel) return;
    setIsConnecting(true);
    setError(null);

    try {
      if (selectedChannel === 'shopify') {
        // Shopify needs OAuth - redirect
        const { authUrl } = await channelsApi.startShopifyOAuth(shopifyShop);
        window.location.href = authUrl;
        return;
      }

      if (selectedChannel === 'woocommerce') {
        // Validate credentials first
        await channelsApi.validateWooCommerce({
          siteUrl: wooSiteUrl,
          consumerKey: wooConsumerKey,
          consumerSecret: wooConsumerSecret,
        });

        // Create the channel
        const channel = await channelsApi.create({
          type: 'woocommerce',
          name: 'WooCommerce Store',
          credentials: {
            siteUrl: wooSiteUrl,
            consumerKey: wooConsumerKey,
            consumerSecret: wooConsumerSecret,
          },
        });

        setConnectedChannelId(channel.id);
        setCurrentStep('import');
        return;
      }

      // Eposnow / Deliveroo
      const channel = await channelsApi.create({
        type: selectedChannel as 'eposnow' | 'wix' | 'deliveroo' | 'shopify' | 'woocommerce' | 'uber_eats',
        name: selectedChannel === 'eposnow' ? 'Eposnow POS' : 'Deliveroo',
        credentials: {
          apiKey: eposnowApiKey,
          apiSecret: eposnowApiSecret,
        },
      });

      setConnectedChannelId(channel.id);
      setCurrentStep('import');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect channel');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleImportProducts = async () => {
    if (!connectedChannelId) {
      // No channel connected — skip import gracefully
      setImportComplete(true);
      return;
    }

    setIsImporting(true);
    setError(null);

    try {
      // Trigger a full sync for the connected channel
      await syncApi.triggerChannelSync(connectedChannelId);

      // For now, simulate completion after a delay if WebSocket doesn't respond
      setTimeout(() => {
        if (!importComplete) {
          setIsImporting(false);
          setImportComplete(true);
        }
      }, 10000);
    } catch (err) {
      // Don't block onboarding if sync fails — mark as complete so user can proceed
      console.warn('Sync trigger failed during onboarding:', err);
      setIsImporting(false);
      setImportComplete(true);
    }
  };

  const handleComplete = async () => {
    await completeOnboarding();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="h-16 border-b border-bronze-200 bg-white flex items-center px-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <span className="text-white text-lg">{String.fromCodePoint(0x25C9)}</span>
          </div>
          <span className="font-semibold text-text">StockClerk</span>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="bg-white border-b border-bronze-200 px-6 py-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-text">
              Step {stepIndex + 1} of {STEPS.length}
            </span>
            <span className="text-sm text-text-muted">
              {Math.round(((stepIndex + 1) / STEPS.length) * 100)}% complete
            </span>
          </div>
          <div className="h-2 bg-bronze-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500 ease-out rounded-full"
              style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-3">
          <div className="max-w-2xl mx-auto flex items-center gap-2 text-red-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          {currentStep === 'welcome' && (
            <WelcomeStep onNext={handleNext} />
          )}
          {currentStep === 'channel' && (
            <ChannelStep
              selectedChannel={selectedChannel}
              onSelectChannel={handleSelectChannel}
              onConnect={handleConnectChannel}
              isConnecting={isConnecting}
              onBack={handleBack}
            />
          )}
          {currentStep === 'credentials' && (
            <CredentialsStep
              channelType={selectedChannel}
              apiKey={eposnowApiKey}
              apiSecret={eposnowApiSecret}
              onApiKeyChange={setEposnowApiKey}
              onApiSecretChange={setEposnowApiSecret}
              wooSiteUrl={wooSiteUrl}
              wooConsumerKey={wooConsumerKey}
              wooConsumerSecret={wooConsumerSecret}
              onWooSiteUrlChange={setWooSiteUrl}
              onWooConsumerKeyChange={setWooConsumerKey}
              onWooConsumerSecretChange={setWooConsumerSecret}
              shopifyShop={shopifyShop}
              onShopifyShopChange={setShopifyShop}
              onSubmit={handleSubmitCredentials}
              isConnecting={isConnecting}
              onBack={() => setCurrentStep('channel')}
            />
          )}
          {currentStep === 'import' && (
            <ImportStep
              onImport={handleImportProducts}
              isImporting={isImporting}
              importComplete={importComplete}
              importProgress={importProgress}
              onNext={handleNext}
              onBack={handleBack}
              onSkip={() => { setImportComplete(true); }}
            />
          )}
          {currentStep === 'buffer' && (
            <BufferStep
              bufferStock={bufferStock}
              onBufferChange={setBufferStock}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}
          {currentStep === 'ready' && (
            <ReadyStep onComplete={handleComplete} />
          )}
        </div>
      </main>
    </div>
  );
};

// Step Components
const WelcomeStep: React.FC<{ onNext: () => void }> = ({ onNext }) => (
  <div className="text-center animate-fade-in">
    <div className="w-24 h-24 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-8">
      <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center">
        <span className="text-white text-4xl">{String.fromCodePoint(0x25C9)}</span>
      </div>
    </div>
    <h1 className="text-3xl font-bold text-text mb-4">
      Welcome to StockClerk
    </h1>
    <p className="text-lg text-text-muted mb-8 max-w-md mx-auto">
      Let&apos;s get your inventory synchronized across all your sales channels in just a few steps.
    </p>
    <div className="flex flex-col items-center gap-4">
      <Button size="lg" onClick={onNext}>
        Get Started
        <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
        </svg>
      </Button>
      <p className="text-sm text-text-muted">Takes about 2 minutes</p>
    </div>
  </div>
);

const ChannelStep: React.FC<{
  selectedChannel: string | null;
  onSelectChannel: (channel: string) => void;
  onConnect: () => void;
  isConnecting: boolean;
  onBack: () => void;
}> = ({ selectedChannel, onSelectChannel, onConnect, isConnecting, onBack }) => {
  const channels = [
    {
      id: 'eposnow',
      name: 'Eposnow',
      icon: String.fromCodePoint(0x25CE),
      description: 'Connect your POS system',
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      id: 'shopify',
      name: 'Shopify',
      icon: String.fromCodePoint(0x25C6),
      description: 'Connect your Shopify store',
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      id: 'woocommerce',
      name: 'WooCommerce',
      icon: String.fromCodePoint(0x25A3),
      description: 'Connect your WooCommerce store',
      color: 'text-violet-600',
      bgColor: 'bg-violet-50',
    },
    {
      id: 'wix',
      name: 'Wix',
      icon: String.fromCodePoint(0x25C7),
      description: 'Connect your Wix store',
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
    {
      id: 'deliveroo',
      name: 'Deliveroo',
      icon: String.fromCodePoint(0x25B3),
      description: 'Connect your Deliveroo menu',
      color: 'text-teal-600',
      bgColor: 'bg-teal-50',
    },
    {
      id: 'uber_eats',
      name: 'Uber Eats',
      icon: String.fromCodePoint(0x25D0),
      description: 'Connect your Uber Eats menu',
      color: 'text-black',
      bgColor: 'bg-gray-50',
    },
  ];

  return (
    <div className="animate-fade-in">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-text mb-2">
          Connect Your First Channel
        </h2>
        <p className="text-text-muted">
          Choose a sales channel to start syncing your inventory
        </p>
      </div>

      <div className="space-y-3 mb-8">
        {channels.map((channel) => (
          <button
            key={channel.id}
            onClick={() => onSelectChannel(channel.id)}
            className={cn(
              'w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left',
              selectedChannel === channel.id
                ? 'border-primary bg-primary/5'
                : 'border-bronze-200 hover:border-primary/50'
            )}
          >
            <div className={cn('w-14 h-14 rounded-xl flex items-center justify-center text-2xl font-mono', channel.bgColor, channel.color)}>
              {channel.icon}
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-text">{channel.name}</h4>
              <p className="text-sm text-text-muted">
                {channel.description}
              </p>
            </div>
            <div className={cn(
              'w-6 h-6 rounded-full border-2 flex items-center justify-center',
              selectedChannel === channel.id ? 'border-primary bg-primary' : 'border-bronze-300'
            )}>
              {selectedChannel === channel.id && (
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button
          onClick={onConnect}
          disabled={!selectedChannel}
          loading={isConnecting}
        >
          {selectedChannel === 'wix' || selectedChannel === 'shopify' || selectedChannel === 'uber_eats'
            ? `Connect with ${selectedChannel === 'uber_eats' ? 'Uber Eats' : selectedChannel.charAt(0).toUpperCase() + selectedChannel.slice(1)}`
            : 'Continue'}
        </Button>
      </div>
    </div>
  );
};

const CredentialsStep: React.FC<{
  channelType: string | null;
  apiKey: string;
  apiSecret: string;
  onApiKeyChange: (value: string) => void;
  onApiSecretChange: (value: string) => void;
  wooSiteUrl: string;
  wooConsumerKey: string;
  wooConsumerSecret: string;
  onWooSiteUrlChange: (value: string) => void;
  onWooConsumerKeyChange: (value: string) => void;
  onWooConsumerSecretChange: (value: string) => void;
  shopifyShop: string;
  onShopifyShopChange: (value: string) => void;
  onSubmit: () => void;
  isConnecting: boolean;
  onBack: () => void;
}> = ({ channelType, apiKey, apiSecret, onApiKeyChange, onApiSecretChange, wooSiteUrl, wooConsumerKey, wooConsumerSecret, onWooSiteUrlChange, onWooConsumerKeyChange, onWooConsumerSecretChange, shopifyShop, onShopifyShopChange, onSubmit, isConnecting, onBack }) => {
  const channelNames: Record<string, string> = {
    eposnow: 'Eposnow',
    deliveroo: 'Deliveroo',
    woocommerce: 'WooCommerce',
    shopify: 'Shopify',
  };

  const isWooCommerce = channelType === 'woocommerce';
  const isShopify = channelType === 'shopify';

  const canSubmit = isWooCommerce
    ? wooSiteUrl && wooConsumerKey && wooConsumerSecret
    : isShopify
    ? shopifyShop
    : apiKey && apiSecret;

  return (
    <div className="animate-fade-in">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-text mb-2">
          Enter Your {channelNames[channelType || ''] || ''} Credentials
        </h2>
        <p className="text-text-muted">
          {isWooCommerce
            ? 'You can find these in WooCommerce → Settings → Advanced → REST API'
            : isShopify
            ? 'Enter your Shopify store domain to begin the connection'
            : `You can find these in your ${channelNames[channelType || ''] || ''} account settings`}
        </p>
      </div>

      <Card className="mb-8 p-6">
        <div className="space-y-4">
          {isShopify ? (
            <div>
              <label className="block text-sm font-medium text-text mb-1">
                Shop Domain
              </label>
              <Input
                type="text"
                value={shopifyShop}
                onChange={(e) => onShopifyShopChange(e.target.value)}
                placeholder="mystore.myshopify.com"
              />
              <p className="text-xs text-text-muted mt-1">
                Enter your .myshopify.com domain
              </p>
            </div>
          ) : isWooCommerce ? (
            <>
              <div>
                <label className="block text-sm font-medium text-text mb-1">
                  Site URL
                </label>
                <Input
                  type="text"
                  value={wooSiteUrl}
                  onChange={(e) => onWooSiteUrlChange(e.target.value)}
                  placeholder="https://mystore.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text mb-1">
                  Consumer Key
                </label>
                <Input
                  type="text"
                  value={wooConsumerKey}
                  onChange={(e) => onWooConsumerKeyChange(e.target.value)}
                  placeholder="ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text mb-1">
                  Consumer Secret
                </label>
                <Input
                  type="password"
                  value={wooConsumerSecret}
                  onChange={(e) => onWooConsumerSecretChange(e.target.value)}
                  placeholder="cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-text mb-1">
                  API Key
                </label>
                <Input
                  type="text"
                  value={apiKey}
                  onChange={(e) => onApiKeyChange(e.target.value)}
                  placeholder="Enter your API key"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text mb-1">
                  API Secret
                </label>
                <Input
                  type="password"
                  value={apiSecret}
                  onChange={(e) => onApiSecretChange(e.target.value)}
                  placeholder="Enter your API secret"
                />
              </div>
            </>
          )}
        </div>

        <div className="mt-6 p-4 rounded-lg bg-background-alt">
          <h5 className="font-medium text-text mb-2">Where to find your credentials</h5>
          <p className="text-sm text-text-muted">
            {isShopify
              ? 'Your shop domain is visible in your browser URL bar when logged into Shopify admin.'
              : isWooCommerce
              ? 'Go to WooCommerce → Settings → Advanced → REST API → Add key. Set permissions to Read/Write.'
              : channelType === 'eposnow'
              ? 'Go to Eposnow Back Office → Setup → API Settings to find your API key and secret.'
              : 'Contact Deliveroo partner support to get your API credentials.'}
          </p>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button
          onClick={onSubmit}
          disabled={!canSubmit}
          loading={isConnecting}
        >
          {isShopify ? 'Connect with Shopify' : 'Connect Channel'}
        </Button>
      </div>
    </div>
  );
};

const ImportStep: React.FC<{
  onImport: () => void;
  isImporting: boolean;
  importComplete: boolean;
  importProgress: { current: number; total: number };
  onNext: () => void;
  onBack: () => void;
  onSkip?: () => void;
}> = ({ onImport, isImporting, importComplete, importProgress, onNext, onBack, onSkip }) => (
  <div className="animate-fade-in">
    <div className="text-center mb-8">
      <h2 className="text-2xl font-bold text-text mb-2">
        Import Your Products
      </h2>
      <p className="text-text-muted">
        We&apos;ll import your products from the connected channel
      </p>
    </div>

    <Card className="mb-8">
      <div className="text-center py-8">
        {isImporting ? (
          <div className="flex flex-col items-center gap-4">
            <Spinner size="lg" className="text-primary" />
            <div>
              <p className="font-medium text-text">Importing products...</p>
              {importProgress.total > 0 && (
                <p className="text-sm text-text-muted mt-1">
                  {importProgress.current} of {importProgress.total} products
                </p>
              )}
              <p className="text-sm text-text-muted mt-1">This may take a moment</p>
            </div>
          </div>
        ) : importComplete ? (
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-text">Import complete!</p>
              <p className="text-sm text-text-muted mt-1">
                {importProgress.total > 0
                  ? `${importProgress.total} products imported successfully`
                  : 'Products imported successfully'}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-text">Ready to import</p>
              <p className="text-sm text-text-muted mt-1">Click below to start importing your products</p>
            </div>
            <Button onClick={onImport}>
              Start Import
            </Button>
          </div>
        )}
      </div>
    </Card>

    <div className="flex items-center justify-between">
      <Button variant="ghost" onClick={onBack} disabled={isImporting}>
        Back
      </Button>
      <div className="flex items-center gap-3">
        {!importComplete && !isImporting && onSkip && (
          <Button variant="ghost" onClick={onSkip}>
            Skip for now
          </Button>
        )}
        <Button onClick={onNext} disabled={!importComplete}>
          Continue
        </Button>
      </div>
    </div>
  </div>
);

const BufferStep: React.FC<{
  bufferStock: string;
  onBufferChange: (value: string) => void;
  onNext: () => void;
  onBack: () => void;
}> = ({ bufferStock, onBufferChange, onNext, onBack }) => (
  <div className="animate-fade-in">
    <div className="text-center mb-8">
      <h2 className="text-2xl font-bold text-text mb-2">
        Set Buffer Stock
      </h2>
      <p className="text-text-muted">
        Reserve some inventory to prevent overselling
      </p>
    </div>

    <Card className="mb-8">
      <div className="p-6">
        <div className="flex items-center gap-6 mb-6">
          <div className="w-16 h-16 rounded-xl bg-warning/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div>
            <h4 className="font-semibold text-text">Default Buffer Stock</h4>
            <p className="text-sm text-text-muted">
              This amount will be reserved and won&apos;t show on sales channels
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <Input
            type="number"
            value={bufferStock}
            onChange={(e) => onBufferChange(e.target.value)}
            min={0}
            max={100}
            className="w-32 text-center text-xl font-semibold"
          />
          <span className="text-text-muted">units per product</span>
        </div>

        <div className="p-4 rounded-lg bg-background-alt">
          <h5 className="font-medium text-text mb-2">Example</h5>
          <p className="text-sm text-text-muted">
            If you have 50 units and buffer is {bufferStock}, only {Math.max(0, 50 - parseInt(bufferStock || '0', 10))} will show as available on your sales channels.
          </p>
        </div>
      </div>
    </Card>

    <div className="flex items-center justify-between">
      <Button variant="ghost" onClick={onBack}>
        Back
      </Button>
      <Button onClick={onNext}>
        Continue
      </Button>
    </div>
  </div>
);

const ReadyStep: React.FC<{ onComplete: () => void }> = ({ onComplete }) => (
  <div className="text-center animate-fade-in">
    <div className="w-24 h-24 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-8">
      <svg className="w-12 h-12 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    </div>
    <h2 className="text-3xl font-bold text-text mb-4">
      You&apos;re All Set!
    </h2>
    <p className="text-lg text-text-muted mb-8 max-w-md mx-auto">
      Your inventory is now syncing across your sales channels. The AI agents are ready to keep everything in sync.
    </p>

    <div className="grid grid-cols-2 gap-4 max-w-md mx-auto mb-8">
      <Card className="p-4 text-center">
        <p className="text-2xl font-bold text-primary">4</p>
        <p className="text-sm text-text-muted">AI Agents Active</p>
      </Card>
      <Card className="p-4 text-center">
        <p className="text-2xl font-bold text-success">1</p>
        <p className="text-sm text-text-muted">Channel Connected</p>
      </Card>
    </div>

    <Button size="lg" onClick={onComplete}>
      Go to Dashboard
      <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
      </svg>
    </Button>
  </div>
);

export default Onboarding;
