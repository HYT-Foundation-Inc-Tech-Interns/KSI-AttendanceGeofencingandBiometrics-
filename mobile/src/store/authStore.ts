import { create } from 'zustand';
import { authApi } from '@/services/api/authApi';
import { tokenStorage } from '@/utils/tokenStorage';
import { UserProfile, LoginRequest } from '@/types/api.types';

interface AuthState {
  // State
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  login: async (credentials: LoginRequest) => {
    try {
      set({ isLoading: true, error: null });

      const response = await authApi.login(credentials);

      // Save tokens
      await tokenStorage.setAccessToken(response.access_token);
      await tokenStorage.setRefreshToken(response.refresh_token);

      set({
        user: response.user,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error: any) {
      const errorMessage =
        error.message || 'Login failed. Please check your credentials.';
      
      set({
        error: errorMessage,
        isLoading: false,
        isAuthenticated: false,
      });

      throw error;
    }
  },

  logout: async () => {
    try {
      set({ isLoading: true });

      // Clear tokens
      await tokenStorage.clearTokens();

      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      console.error('Logout error:', error);
      // Even if clearing fails, reset state
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  checkAuth: async () => {
    try {
      set({ isLoading: true });

      const hasTokens = await tokenStorage.hasTokens();

      if (!hasTokens) {
        set({ isAuthenticated: false, isLoading: false });
        return;
      }

      // If we have tokens, assume authenticated
      // The API client will handle token refresh if needed
      set({ isAuthenticated: true, isLoading: false });
      
      // TODO: Optionally fetch user profile here
    } catch (error) {
      set({ isAuthenticated: false, isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
