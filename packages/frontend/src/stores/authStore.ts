import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, UserSettings } from '../types';
import { authApi, clearStoredToken, type AuthResponse, type BackendSafeUser } from '../api/client';
import type { Tenant } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, businessName: string) => Promise<void>;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  updateSettings: (settings: Partial<UserSettings>) => void;
  completeOnboarding: () => void;
}

// Default settings for new users (backend doesn't store these yet)
const defaultSettings: UserSettings = {
  lowStockThreshold: 10,
  defaultBufferStock: 5,
  notificationsEnabled: true,
  emailAlerts: true,
  syncInterval: 5,
};

// Map backend user + tenant to frontend User type
function mapToFrontendUser(backendUser: BackendSafeUser, tenant: Tenant): User {
  return {
    id: backendUser.id,
    email: backendUser.email,
    name: backendUser.name || backendUser.email.split('@')[0],
    businessName: tenant.name,
    onboardingComplete: backendUser.onboardingComplete ?? false,
    role: backendUser.role,
    isSuperAdmin: backendUser.isSuperAdmin ?? false,
    settings: defaultSettings,
  };
}

// Helper to slugify business name for tenant slug
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email: string, password: string) => {
        set({ isLoading: true });

        try {
          const response: AuthResponse = await authApi.login({ email, password });

          const frontendUser = mapToFrontendUser(response.user, response.tenant);

          set({
            user: frontendUser,
            token: response.tokens.accessToken,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      register: async (email: string, password: string, name: string, businessName: string) => {
        set({ isLoading: true });

        try {
          const response: AuthResponse = await authApi.register({
            tenantName: businessName,
            tenantSlug: slugify(businessName),
            email,
            password,
            name,
          });

          const frontendUser = mapToFrontendUser(response.user, response.tenant);
          // New registrations always start with onboarding incomplete
          frontendUser.onboardingComplete = false;

          set({
            user: frontendUser,
            token: response.tokens.accessToken,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      logout: () => {
        // Clear the API client's stored token
        clearStoredToken();
        set({
          user: null,
          token: null,
          isAuthenticated: false,
        });
      },

      updateUser: (updates: Partial<User>) => {
        const { user } = get();
        if (user) {
          set({ user: { ...user, ...updates } });
        }
      },

      updateSettings: (settings: Partial<UserSettings>) => {
        const { user } = get();
        if (user) {
          set({
            user: {
              ...user,
              settings: { ...user.settings, ...settings },
            },
          });
        }
      },

      completeOnboarding: () => {
        const { user } = get();
        if (user) {
          set({ user: { ...user, onboardingComplete: true } });
        }
      },
    }),
    {
      name: 'stockclerk-auth',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
