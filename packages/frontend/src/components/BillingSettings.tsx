import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { billingApi, BillingStatus } from '../api/client';
import { cn } from '../lib/utils';

interface Toast {
  type: 'success' | 'error';
  message: string;
}

export const BillingSettings: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<'starter' | 'growth' | null>(null);

  useEffect(() => {
    loadBillingStatus();
  }, []);

  useEffect(() => {
    // Check for URL query params for success/error messages
    const billingParam = searchParams.get('billing');
    if (billingParam === 'success') {
      setToast({
        type: 'success',
        message: 'Subscription updated successfully!',
      });
    } else if (billingParam === 'canceled') {
      setToast({
        type: 'error',
        message: 'Subscription update was canceled.',
      });
    }

    // Clear toast after 5 seconds
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [searchParams, toast]);

  const loadBillingStatus = async () => {
    try {
      setLoading(true);
      const status = await billingApi.getStatus();
      setBillingStatus(status);
    } catch (error) {
      console.error('Failed to load billing status:', error);
      setToast({
        type: 'error',
        message: 'Failed to load billing information',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCheckout = async (plan: 'starter' | 'growth') => {
    try {
      setCheckoutLoading(plan);
      const { url } = await billingApi.createCheckout(plan);
      window.location.href = url;
    } catch (error) {
      console.error('Failed to create checkout:', error);
      setToast({
        type: 'error',
        message: 'Failed to start checkout. Please try again.',
      });
      setCheckoutLoading(null);
    }
  };

  const handleManageSubscription = async () => {
    try {
      const { url } = await billingApi.openPortal();
      window.location.href = url;
    } catch (error) {
      console.error('Failed to open billing portal:', error);
      setToast({
        type: 'error',
        message: 'Failed to open billing portal. Please try again.',
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-text-muted">Loading billing information...</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!billingStatus) {
    return (
      <Card>
        <CardContent>
          <div className="text-center py-12">
            <p className="text-error">Failed to load billing information</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getPlanStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'active':
        return 'success';
      case 'trialing':
        return 'primary';
      case 'past_due':
        return 'error';
      case 'canceled':
        return 'default';
      default:
        return 'default';
    }
  };

  const getPlanStatusLabel = (status: string) => {
    switch (status) {
      case 'active':
        return 'Active';
      case 'trialing':
        return 'Trial';
      case 'past_due':
        return 'Past Due';
      case 'canceled':
        return 'Canceled';
      default:
        return status;
    }
  };

  const shopUsagePercent = (billingStatus.currentShopCount / billingStatus.shopLimit) * 100;
  const isOnTrial = billingStatus.planStatus === 'trialing';
  const isActive = billingStatus.planStatus === 'active';
  const isCanceled = billingStatus.planStatus === 'canceled';

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div
          className={cn(
            'p-4 rounded-lg border',
            toast.type === 'success'
              ? 'bg-success/10 border-success/30 text-success'
              : 'bg-error/10 border-error/30 text-error'
          )}
        >
          {toast.message}
        </div>
      )}

      {/* Current Plan Card */}
      <Card>
        <CardHeader>
          <CardTitle>Current Plan</CardTitle>
          <CardDescription>Your subscription details</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Plan Name and Status */}
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-semibold text-text capitalize">
                  {billingStatus.plan} Plan
                </h3>
                <p className="text-sm text-text-muted mt-1">
                  {billingStatus.planStatus === 'trialing'
                    ? `Your free trial ends on ${new Date(billingStatus.trialEndsAt!).toLocaleDateString()}`
                    : billingStatus.planStatus === 'active'
                    ? 'Your subscription is active'
                    : billingStatus.planStatus === 'canceled'
                    ? 'Your subscription has been canceled'
                    : 'Your subscription needs attention'}
                </p>
              </div>
              <Badge variant={getPlanStatusBadgeVariant(billingStatus.planStatus)}>
                {getPlanStatusLabel(billingStatus.planStatus)}
              </Badge>
            </div>

            {/* Trial Countdown */}
            {isOnTrial && billingStatus.trialEndsAt && (
              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                <p className="text-sm font-medium text-text">
                  {Math.ceil(
                    (new Date(billingStatus.trialEndsAt).getTime() - Date.now()) /
                      (1000 * 60 * 60 * 24)
                  )}{' '}
                  days remaining in your 14-day free trial
                </p>
              </div>
            )}

            {/* Shop Usage */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium text-text">Shop Limit</h4>
                <span className="text-sm text-text-muted">
                  {billingStatus.currentShopCount} of {billingStatus.shopLimit}
                </span>
              </div>
              <div className="w-full bg-background-alt rounded-full h-2">
                <div
                  className={cn(
                    'h-2 rounded-full transition-all',
                    shopUsagePercent >= 100
                      ? 'bg-error'
                      : shopUsagePercent >= 80
                      ? 'bg-warning'
                      : 'bg-success'
                  )}
                  style={{ width: `${Math.min(shopUsagePercent, 100)}%` }}
                />
              </div>
              <p className="text-xs text-text-muted mt-2">
                {billingStatus.canAddShop
                  ? `You can add ${billingStatus.shopLimit - billingStatus.currentShopCount} more shop${billingStatus.shopLimit - billingStatus.currentShopCount !== 1 ? 's' : ''}`
                  : 'You have reached your shop limit. Upgrade to add more shops.'}
              </p>
            </div>

            {/* Action Buttons */}
            <div className="pt-4 border-t border-bronze-200">
              {isActive && (
                <Button
                  onClick={handleManageSubscription}
                  variant="secondary"
                  className="w-full"
                >
                  Manage Subscription
                </Button>
              )}
              {(isOnTrial || isCanceled) && !isActive && (
                <div>
                  <p className="text-sm text-text-muted mb-4">
                    {isCanceled
                      ? 'Choose a plan to reactivate your account.'
                      : 'Choose a plan to continue after your trial ends.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Upgrade Plans (show if on trial or canceled) */}
      {(isOnTrial || isCanceled) && (
        <div>
          <h3 className="text-lg font-semibold text-text mb-4">Choose Your Plan</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Starter Plan Card */}
            <Card className="relative">
              <CardHeader>
                <CardTitle>Starter</CardTitle>
                <CardDescription>For small shops</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <span className="text-3xl font-bold text-text">£50</span>
                    <span className="text-text-muted">/month</span>
                  </div>
                  <ul className="space-y-2">
                    <li className="flex items-start gap-2 text-sm text-text-secondary">
                      <span className="text-success font-bold mt-0.5">✓</span>
                      <span>1–3 shops</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm text-text-secondary">
                      <span className="text-success font-bold mt-0.5">✓</span>
                      <span>Real-time inventory sync</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm text-text-secondary">
                      <span className="text-success font-bold mt-0.5">✓</span>
                      <span>AI-powered stock monitoring</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm text-text-secondary">
                      <span className="text-success font-bold mt-0.5">✓</span>
                      <span>Email alerts</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm text-text-secondary">
                      <span className="text-success font-bold mt-0.5">✓</span>
                      <span>Standard support</span>
                    </li>
                  </ul>
                </div>
              </CardContent>
              <CardFooter>
                <Button
                  onClick={() => handleCheckout('starter')}
                  variant="secondary"
                  className="w-full"
                  loading={checkoutLoading === 'starter'}
                >
                  {checkoutLoading === 'starter' ? 'Loading...' : 'Subscribe Now'}
                </Button>
              </CardFooter>
            </Card>

            {/* Growth Plan Card */}
            <Card className="relative border-primary border-2">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge variant="primary">Recommended</Badge>
              </div>
              <CardHeader className="pt-6">
                <CardTitle>Growth</CardTitle>
                <CardDescription>For growing shops</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <span className="text-3xl font-bold text-text">£100</span>
                    <span className="text-text-muted">/month</span>
                  </div>
                  <ul className="space-y-2">
                    <li className="flex items-start gap-2 text-sm text-text-secondary">
                      <span className="text-success font-bold mt-0.5">✓</span>
                      <span>4–10 shops</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm text-text-secondary">
                      <span className="text-success font-bold mt-0.5">✓</span>
                      <span>Priority sync processing</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm text-text-secondary">
                      <span className="text-success font-bold mt-0.5">✓</span>
                      <span>Advanced analytics</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm text-text-secondary">
                      <span className="text-success font-bold mt-0.5">✓</span>
                      <span>Phone support</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm text-text-secondary">
                      <span className="text-success font-bold mt-0.5">✓</span>
                      <span>Dedicated account manager</span>
                    </li>
                  </ul>
                </div>
              </CardContent>
              <CardFooter>
                <Button
                  onClick={() => handleCheckout('growth')}
                  variant="primary"
                  className="w-full"
                  loading={checkoutLoading === 'growth'}
                >
                  {checkoutLoading === 'growth' ? 'Loading...' : 'Subscribe Now'}
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillingSettings;
