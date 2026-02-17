import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './hooks/useApi';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/layout/Layout';
import { FullPageSpinner } from './components/ui/Spinner';
import { AdminLayout } from './components/layout/AdminLayout';

// Lazy load pages for code splitting
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Products = lazy(() => import('./pages/Products'));
const Channels = lazy(() => import('./pages/Channels'));
const Settings = lazy(() => import('./pages/Settings'));
const Sync = lazy(() => import('./pages/Sync'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const Login = lazy(() => import('./pages/Auth/Login'));
const Register = lazy(() => import('./pages/Auth/Register'));
const ForgotPassword = lazy(() => import('./pages/Auth/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/Auth/ResetPassword'));

// Connect pages (marketplace landing) - lazy loaded
const EposnowConnect = lazy(() => import('./pages/Connect/EposnowConnect'));

// Admin pages - lazy loaded
const AdminDashboard = lazy(() => import('./pages/Admin/Dashboard'));
const AdminTenants = lazy(() => import('./pages/Admin/Tenants'));
const AdminTenantDetail = lazy(() => import('./pages/Admin/TenantDetail'));
const AdminSyncMonitor = lazy(() => import('./pages/Admin/SyncMonitor'));
const AdminSystemHealth = lazy(() => import('./pages/Admin/SystemHealth'));

// Protected Route wrapper
const ProtectedRoute: React.FC = () => {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Redirect to onboarding if not completed
  if (user && !user.onboardingComplete) {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <Layout>
      <Suspense fallback={<FullPageSpinner />}>
        <Outlet />
      </Suspense>
    </Layout>
  );
};

// Public Route wrapper (redirects to dashboard if already authenticated)
const PublicRoute: React.FC = () => {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Outlet />
    </Suspense>
  );
};

// Onboarding Route wrapper
const OnboardingRoute: React.FC = () => {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.onboardingComplete) {
    return <Navigate to="/" replace />;
  }

  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Outlet />
    </Suspense>
  );
};

// Admin Route wrapper - checks for super admin status
const AdminRoute: React.FC = () => {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!user?.isSuperAdmin) {
    return <Navigate to="/" replace />;
  }

  return <AdminLayout />;
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route element={<PublicRoute />}>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
          </Route>

          {/* Marketplace connect routes (standalone - no auth wrapper) */}
          <Route
            path="/connect/eposnow"
            element={
              <Suspense fallback={<FullPageSpinner />}>
                <EposnowConnect />
              </Suspense>
            }
          />

          {/* Onboarding route */}
          <Route element={<OnboardingRoute />}>
            <Route path="/onboarding" element={<Onboarding />} />
          </Route>

          {/* Protected routes */}
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/products" element={<Products />} />
            <Route path="/channels" element={<Channels />} />
            <Route path="/sync" element={<Sync />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          {/* Admin routes */}
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/tenants" element={<AdminTenants />} />
            <Route path="/admin/tenants/:id" element={<AdminTenantDetail />} />
            <Route path="/admin/sync-monitor" element={<AdminSyncMonitor />} />
            <Route path="/admin/system-health" element={<AdminSystemHealth />} />
          </Route>

          {/* Catch all - redirect to home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
