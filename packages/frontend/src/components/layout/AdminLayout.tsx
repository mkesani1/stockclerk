import React, { Suspense } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { FullPageSpinner } from '../ui/Spinner';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';

export const AdminLayout: React.FC = () => {
  const navigate = useNavigate();

  const navLinks = [
    { label: 'Overview', path: '/admin' },
    { label: 'Tenants', path: '/admin/tenants' },
    { label: 'Sync Monitor', path: '/admin/sync-monitor' },
    { label: 'System Health', path: '/admin/system-health' },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <div className="fixed left-0 top-0 h-screen w-56 bg-white border-r border-bronze-200 p-6 flex flex-col">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => navigate('/')}
            className="mb-6"
          >
            ← Back to Dashboard
          </Button>
          <h2 className="text-lg font-bold text-text">Admin Panel</h2>
          <p className="text-xs text-text-muted mt-1">System Administration</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-2">
          {navLinks.map((link) => (
            <NavLink
              key={link.path}
              to={link.path}
              className={({ isActive }) =>
                cn(
                  'block px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-white'
                    : 'text-text hover:bg-background-alt'
                )
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="pt-6 border-t border-bronze-200">
          <p className="text-xs text-text-muted">Admin Zone</p>
          <p className="text-xs text-text-muted mt-2">System management and monitoring</p>
        </div>
      </div>

      {/* Main Content */}
      <main className="ml-56 min-h-screen bg-background">
        <Suspense fallback={<FullPageSpinner />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
};
