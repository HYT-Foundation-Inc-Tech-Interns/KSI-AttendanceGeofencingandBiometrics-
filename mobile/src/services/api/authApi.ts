import { apiClient } from './apiClient';
import { LoginRequest, LoginResponse, RefreshTokenRequest } from '@/types/api.types';

export const authApi = {
  /**
   * Login with email and password
   */
  login: async (credentials: LoginRequest): Promise<LoginResponse> => {
    return apiClient.post<LoginResponse>('/auth/login', credentials);
  },

  /**
   * Refresh access token
   */
  refreshToken: async (data: RefreshTokenRequest): Promise<LoginResponse> => {
    return apiClient.post<LoginResponse>('/auth/refresh', data);
  },
};
