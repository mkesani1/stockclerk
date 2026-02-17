import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { apiClient } from '../../api/client';

export const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email) {
      setError('Please enter your email address');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    try {
      await apiClient.post('/auth/forgot-password', { email });
      setSubmitted(true);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-white text-3xl">{String.fromCodePoint(0x25C9)}</span>
            </div>
            <h1 className="text-2xl font-bold text-text">Check your email</h1>
          </div>
          <Card variant="elevated">
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-text mb-2">
                If an account exists for <strong>{email}</strong>, we've sent a password reset link.
              </p>
              <p className="text-text-muted text-sm mb-6">
                The link will expire in 1 hour. Check your spam folder if you don't see it.
              </p>
              <Link
                to="/login"
                className="text-primary hover:text-primary-dark font-medium"
              >
                Back to Sign In
              </Link>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-3xl">{String.fromCodePoint(0x25C9)}</span>
          </div>
          <h1 className="text-2xl font-bold text-text">Forgot your password?</h1>
          <p className="text-text-muted mt-1">Enter your email and we'll send you a reset link</p>
        </div>

        <Card variant="elevated">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-error/10 text-error text-sm">
                {error}
              </div>
            )}

            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              autoComplete="email"
            />

            <Button type="submit" className="w-full" loading={isLoading}>
              Send Reset Link
            </Button>
          </form>

          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="text-sm text-primary hover:text-primary-dark font-medium"
            >
              Back to Sign In
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default ForgotPassword;
