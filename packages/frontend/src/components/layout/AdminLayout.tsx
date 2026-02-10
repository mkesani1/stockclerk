import React, { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/Badge';
import { FullPageSpinner } from '../ui/Spinner';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const adminNavItems: NavItem[] = [
  {
    path: '/admin',
    label: 'Overview',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    path: '/admin/tenants',
    label: 'Tenants',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3.5a1.5 1.5 0 01-1.5-1.5V5.5A1.5 1.5 0 013.5 4h17A1.5 1.5 0 0122 5.5v12a1.5 1.5 0 01-1.5 1.5z" />
      </svg>
    ),
  },
  {
    path: '/admin/sync-monitor',
    label: 'Sync Monitor',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    ),
  },
  {
    path: '/admin/system-health',
    label: 'System Health',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

export const AdminLayout: React.FC = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-screen w-64 bg-white border-r border-bronze-200 z-40 flex flex-col">
        {/* Header */}
        <div className="h-16 flex items-center gap-3 px-4 border-b border-bronze-200">
          <NavLink to="/" className="flex items-center gap-3 flex-1 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <span className="text-white text-lg">{String.fromCodePoint(0x25C9)}</span>
            </div>
            <span className="font-semibold text-text">StockClerk Admin</span>
          </NavLink>
        </div>

        {/* Back to Dashboard */}
        <div className="px-3 py-2 border-b border-bronze-200">
          <NavLink
            to="/"
            className="flex items-center gap-2 px-3 py-2 text-sm text-text-muted hover:text-primary hover:bg-background-alt rounded-lg transition-all duration-200"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Dashboard
          </NavLink>
        </div>

        {/* Navigation */}
        <nav className="p-3 space-y-1 flex-1">
          {adminNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200',
                  isActive
                    ? 'bg-primary text-white'
                    : 'text-text-muted hover:bg-background-alt hover:text-text'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn(isActive && 'text-white')}>{item.icon}</span>
                  <span className="font-medium">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Admin Indicator Badge */}
        <div className="px-4 py-3 border-t border-bronze-200">
          <Badge variant="primary" className="w-full justify-center">
            {String.fromCodePoint(0x26A1)} Admin Access
          </Badge>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-64 min-h-screen bg-background">
        <Suspense fallback={<FullPageSpinner />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
};
