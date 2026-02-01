import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, UserSettings } from '../types';

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

// Mock user for development
const mockUser: User = {
  id: '1',
  email: 'demo@stockclerk.ai',
  name: 'Demo User',
  businessName: 'Demo Business',
  onboardingComplete: true,
  settings: {
    lowStockThreshold: 10,
    defaultBufferStock: 5,
    notificationsEnabled: true,
    emailAlerts: true,
    syncInterval: 5,
  },
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email: string, _password: string) => {
        set({ isLoading: true });

        // Simulate API call
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Mock successful login
        set({
          user: { ...mockUser, email },
          token: 'mock-jwt-token',
          isAuthenticated: true,
          isLoading: false,
        });
      },

      register: async (email: string, _password: string, name: string, businessName: string) => {
        set({ isLoading: true });

        // Simulate API call
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Mock successful registration
        const newUser: User = {
          ...mockUser,
          id: Math.random().toString(36).substr(2, 9),
          email,
          name,
          businessName,
          onboardingComplete: false,
        };

        set({
          user: newUser,
          token: 'mock-jwt-token',
          isAuthenticated: true,
          isLoading: false,
        });
      },

      logout: () => {
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
