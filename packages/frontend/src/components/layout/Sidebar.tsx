import React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { useAuth } from '../../hooks/useAuth';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  {
    path: '/',
    label: 'Dashboard',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    path: '/products',
    label: 'Products',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
  },
  {
    path: '/channels',
    label: 'Channels',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    path: '/sync',
    label: 'Sync Center',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    ),
  },
  {
    path: '/settings',
    label: 'Settings',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ collapsed = false, onToggle }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen bg-white border-r border-bronze-200 z-40 transition-all duration-300 flex flex-col',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-bronze-200">
        <NavLink to="/" className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <span className="text-white text-lg">{String.fromCodePoint(0x25C9)}</span>
          </div>
          {!collapsed && (
            <span className="font-semibold text-text">StockClerk</span>
          )}
        </NavLink>
        {onToggle && (
          <button
            onClick={onToggle}
            className="p-1.5 text-text-muted hover:text-text hover:bg-background-alt rounded-lg transition-colors"
          >
            <svg
              className={cn('w-5 h-5 transition-transform', collapsed && 'rotate-180')}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="p-3 space-y-1 flex-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200',
                isActive
                  ? 'bg-primary text-white'
                  : 'text-text-muted hover:bg-background-alt hover:text-text'
              )}
            >
              <span className={cn(isActive && 'text-white')}>{item.icon}</span>
              {!collapsed && <span className="font-medium">{item.label}</span>}
            </NavLink>
          );
        })}

        {/* Admin link - only for super admins */}
        {user?.isSuperAdmin && (
          <NavLink
            to="/admin"
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200',
              location.pathname.startsWith('/admin')
                ? 'bg-primary text-white'
                : 'text-text-muted hover:bg-background-alt hover:text-text'
            )}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            {!collapsed && <span className="font-medium">Admin</span>}
          </NavLink>
        )}
      </nav>

      {/* Bottom Section */}
      <div className="border-t border-bronze-200">
        {/* Visit Website Link */}
        {!collapsed && (
          <div className="px-4 pt-3">
            <a
              href="/"
              className="flex items-center gap-2 px-3 py-2 text-sm text-text-muted hover:text-primary rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Visit Website
            </a>
          </div>
        )}

        {/* Sign Out Button */}
        <div className="px-4 py-2">
          <button
            onClick={handleLogout}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-error hover:bg-error/5 w-full',
              collapsed && 'justify-center'
            )}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {!collapsed && <span className="font-medium text-sm">Sign Out</span>}
          </button>
        </div>

        {/* AI Agents Section */}
        {!collapsed && (
          <div className="p-4 border-t border-bronze-200">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
              AI Agents
            </p>
            <div className="grid grid-cols-4 gap-2">
              <AgentIcon icon={String.fromCodePoint(0x25C9)} label="Watcher" active />
              <AgentIcon icon={String.fromCodePoint(0x21BB)} label="Sync" active />
              <AgentIcon icon={String.fromCodePoint(0x2B21)} label="Guardian" active />
              <AgentIcon icon={String.fromCodePoint(0x2691)} label="Alert" />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

const AgentIcon: React.FC<{ icon: string; label: string; active?: boolean }> = ({
  icon,
  label,
  active = false,
}) => {
  return (
    <div className="flex flex-col items-center gap-1" title={label}>
      <div
        className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center text-lg font-mono transition-colors',
          active
            ? 'bg-primary/10 text-primary'
            : 'bg-bronze-100 text-text-muted'
        )}
      >
        {icon}
      </div>
      {active && (
        <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
      )}
    </div>
  );
};
