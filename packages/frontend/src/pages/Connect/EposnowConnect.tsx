import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { authApi, channelsApi, setStoredToken } from '../../api/client';

type AuthMode = 'choice' | 'login' | 'register';
type ConnectionState = 'idle' | 'connecting' | 'success' | 'error';

export const EposnowConnect: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const deviceId = searchParams.get('deviceId');

  // Auth state
  const [authMode, setAuthMode] = useState<AuthMode>('choice');
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register form state
  const [registerName, setRegisterName] = useState('');
  const [registerBusinessName, setRegisterBusinessName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState('');

  // Connection state
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [connectionError, setConnectionError] = useState('');

  // Redirect if no deviceId
  useEffect(() => {
    if (!deviceId) {
      setConnectionError('Missing deviceId parameter');
      setTimeout(() => navigate('/login'), 3000);
    }
  }, [deviceId, navigate]);

  const createEposnowChannel = async () => {
    if (!deviceId) {
      throw new Error('deviceId is required');
    }

    setConnectionState('connecting');
    try {
      await channelsApi.create({
        type: 'eposnow',
        name: 'Eposnow POS',
        credentials: {
          deviceId,
        },
        externalInstanceId: deviceId,
      });
      setConnectionState('success');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect Eposnow';
      setConnectionError(errorMessage);
      setConnectionState('error');
      throw err;
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    if (!loginEmail || !loginPassword) {
      setAuthError('Please fill in all fields');
      return;
    }

    setIsAuthLoading(true);
    try {
      const authResponse = await authApi.login({
        email: loginEmail,
        password: loginPassword,
      });

      // Store token
      setStoredToken(authResponse.tokens.accessToken);

      // Create Eposnow channel
      await createEposnowChannel();

      // Redirect to dashboard after successful connection
      setTimeout(() => {
        navigate('/');
      }, 1500);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Login failed. Please try again.');
      setIsAuthLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    if (!registerName || !registerBusinessName || !registerEmail || !registerPassword || !registerConfirmPassword) {
      setAuthError('Please fill in all fields');
      return;
    }

    if (registerPassword !== registerConfirmPassword) {
      setAuthError('Passwords do not match');
      return;
    }

    if (registerPassword.length < 8) {
      setAuthError('Password must be at least 8 characters');
      return;
    }

    setIsAuthLoading(true);
    try {
      const authResponse = await authApi.register({
        name: registerName,
        tenantName: registerBusinessName,
        tenantSlug: registerBusinessName
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-')
          .substring(0, 50),
        email: registerEmail,
        password: registerPassword,
      });

      // Store token
      setStoredToken(authResponse.tokens.accessToken);

      // Create Eposnow channel
      await createEposnowChannel();

      // Redirect to onboarding after successful connection
      setTimeout(() => {
        navigate('/onboarding');
      }, 1500);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Registration failed. Please try again.');
      setIsAuthLoading(false);
    }
  };

  // Render choice screen
  if (authMode === 'choice') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-white text-3xl">{String.fromCodePoint(0x25C9)}</span>
            </div>
            <h1 className="text-2xl font-bold text-text">Connect your Eposnow POS</h1>
            <p className="text-text-muted mt-2">Sync your inventory across all channels with StockClerk</p>
          </div>

          {/* Features */}
          <Card variant="elevated" className="mb-6">
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-primary text-xs font-bold">✓</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-text">Real-time inventory sync</p>
                  <p className="text-xs text-text-muted">Keep your stock levels accurate</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-primary text-xs font-bold">✓</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-text">Multi-channel management</p>
                  <p className="text-xs text-text-muted">Manage all your sales channels in one place</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-primary text-xs font-bold">✓</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-text">Instant alerts</p>
                  <p className="text-xs text-text-muted">Get notified of critical inventory events</p>
                </div>
              </div>
            </div>
          </Card>

          {/* Action Buttons */}
          <div className="space-y-3">
            <Button
              onClick={() => setAuthMode('login')}
              className="w-full"
              variant="primary"
            >
              Sign in to existing account
            </Button>
            <Button
              onClick={() => setAuthMode('register')}
              className="w-full"
              variant="secondary"
            >
              Create new account
            </Button>
          </div>

          {/* Info */}
          <p className="text-xs text-text-muted text-center mt-6">
            Your Eposnow device will be connected once you complete the setup process.
          </p>
        </div>
      </div>
    );
  }

  // Render login screen
  if (authMode === 'login') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-white text-3xl">{String.fromCodePoint(0x25C9)}</span>
            </div>
            <h1 className="text-2xl font-bold text-text">Welcome back</h1>
            <p className="text-text-muted mt-1">Sign in to connect your Eposnow POS</p>
          </div>

          <Card variant="elevated">
            <form onSubmit={handleLogin} className="space-y-4">
              {authError && (
                <div className="p-3 rounded-lg bg-error/10 text-error text-sm">
                  {authError}
                </div>
              )}

              {connectionState === 'success' && (
                <div className="p-3 rounded-lg bg-success/10 text-success text-sm">
                  Successfully connected! Redirecting...
                </div>
              )}

              {connectionState === 'connecting' && (
                <div className="p-3 rounded-lg bg-info/10 text-info text-sm">
                  Connecting your Eposnow device...
                </div>
              )}

              <Input
                label="Email"
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="you@business.com"
                autoComplete="email"
                disabled={isAuthLoading || connectionState === 'connecting'}
              />

              <Input
                label="Password"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                disabled={isAuthLoading || connectionState === 'connecting'}
              />

              <Button
                type="submit"
                className="w-full"
                loading={isAuthLoading || connectionState === 'connecting'}
                disabled={connectionState === 'connecting'}
              >
                {connectionState === 'connecting' ? 'Connecting...' : 'Sign In & Connect'}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-text-muted">
                Don&apos;t have an account?{' '}
                <button
                  onClick={() => setAuthMode('register')}
                  className="text-primary hover:text-primary-dark font-medium"
                >
                  Create one
                </button>
              </p>
              <button
                onClick={() => setAuthMode('choice')}
                className="text-xs text-text-muted hover:text-text mt-3"
              >
                ← Back
              </button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // Render register screen
  if (authMode === 'register') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-white text-3xl">{String.fromCodePoint(0x25C9)}</span>
            </div>
            <h1 className="text-2xl font-bold text-text">Create your account</h1>
            <p className="text-text-muted mt-1">Set up StockClerk for your Eposnow POS</p>
          </div>

          <Card variant="elevated">
            <form onSubmit={handleRegister} className="space-y-4">
              {authError && (
                <div className="p-3 rounded-lg bg-error/10 text-error text-sm">
                  {authError}
                </div>
              )}

              {connectionState === 'success' && (
                <div className="p-3 rounded-lg bg-success/10 text-success text-sm">
                  Account created and Eposnow connected! Redirecting...
                </div>
              )}

              {connectionState === 'connecting' && (
                <div className="p-3 rounded-lg bg-info/10 text-info text-sm">
                  Setting up your account and connecting your device...
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Your Name"
                  value={registerName}
                  onChange={(e) => setRegisterName(e.target.value)}
                  placeholder="John Doe"
                  autoComplete="name"
                  disabled={isAuthLoading || connectionState === 'connecting'}
                />
                <Input
                  label="Business Name"
                  value={registerBusinessName}
                  onChange={(e) => setRegisterBusinessName(e.target.value)}
                  placeholder="My Shop"
                  autoComplete="organization"
                  disabled={isAuthLoading || connectionState === 'connecting'}
                />
              </div>

              <Input
                label="Email"
                type="email"
                value={registerEmail}
                onChange={(e) => setRegisterEmail(e.target.value)}
                placeholder="you@business.com"
                autoComplete="email"
                disabled={isAuthLoading || connectionState === 'connecting'}
              />

              <Input
                label="Password"
                type="password"
                value={registerPassword}
                onChange={(e) => setRegisterPassword(e.target.value)}
                placeholder="Create a password"
                autoComplete="new-password"
                hint="Must be at least 8 characters"
                disabled={isAuthLoading || connectionState === 'connecting'}
              />

              <Input
                label="Confirm Password"
                type="password"
                value={registerConfirmPassword}
                onChange={(e) => setRegisterConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                autoComplete="new-password"
                disabled={isAuthLoading || connectionState === 'connecting'}
              />

              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id="terms"
                  className="w-4 h-4 mt-0.5 rounded border-bronze-300 text-primary focus:ring-primary"
                  required
                  disabled={isAuthLoading || connectionState === 'connecting'}
                />
                <label htmlFor="terms" className="text-sm text-text-muted">
                  I agree to the Terms of Service and Privacy Policy
                </label>
              </div>

              <Button
                type="submit"
                className="w-full"
                loading={isAuthLoading || connectionState === 'connecting'}
                disabled={connectionState === 'connecting'}
              >
                {connectionState === 'connecting' ? 'Setting up...' : 'Create Account & Connect'}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-text-muted">
                Already have an account?{' '}
                <button
                  onClick={() => setAuthMode('login')}
                  className="text-primary hover:text-primary-dark font-medium"
                >
                  Sign in
                </button>
              </p>
              <button
                onClick={() => setAuthMode('choice')}
                className="text-xs text-text-muted hover:text-text mt-3"
              >
                ← Back
              </button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return null;
};

export default EposnowConnect;
