import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from '@/constants/config';
import { tokenStorage } from '@/utils/tokenStorage';
import { ApiError } from '@/types/api.types';

/**
 * Axios instance with authentication and error handling
 */
class ApiClient {
  private client: AxiosInstance;
  private refreshPromise: Promise<string> | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    // Request interceptor: Add auth token
    this.client.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        const token = await tokenStorage.getAccessToken();
        
        if (token && config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
        }

        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor: Handle token refresh
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & {
          _retry?: boolean;
        };

        // If 401 and not already retried, try to refresh token
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          try {
            // Use existing refresh promise or create new one
            if (!this.refreshPromise) {
              this.refreshPromise = this.refreshAccessToken();
            }

            const newAccessToken = await this.refreshPromise;
            this.refreshPromise = null;

            // Retry original request with new token
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            }

            return this.client(originalRequest);
          } catch (refreshError) {
            // Refresh failed, user needs to login again
            this.refreshPromise = null;
            await tokenStorage.clearTokens();
            
            // Emit logout event (handled by auth store)
            // This could be improved with an event emitter
            return Promise.reject(refreshError);
          }
        }

        return Promise.reject(this.normalizeError(error));
      }
    );
  }

  private async refreshAccessToken(): Promise<string> {
    const refreshToken = await tokenStorage.getRefreshToken();

    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await axios.post(
        `${API_BASE_URL}/auth/refresh`,
        { refresh_token: refreshToken },
        { timeout: 10000 }
      );

      const { access_token, refresh_token } = response.data;

      await tokenStorage.setAccessToken(access_token);
      await tokenStorage.setRefreshToken(refresh_token);

      return access_token;
    } catch (error) {
      await tokenStorage.clearTokens();
      throw error;
    }
  }

  private normalizeError(error: AxiosError): ApiError {
    if (error.response) {
      // Server responded with error
      const data = error.response.data as any;
      return {
        code: data?.error?.code || 'SERVER_ERROR',
        message: data?.error?.message || 'An error occurred',
        details: data?.error?.details,
        timestamp: data?.timestamp,
        path: data?.path,
      };
    } else if (error.request) {
      // Request made but no response
      return {
        code: 'NETWORK_ERROR',
        message: 'Network error. Please check your connection.',
      };
    } else {
      // Error setting up request
      return {
        code: 'REQUEST_ERROR',
        message: error.message || 'Request failed',
      };
    }
  }

  // Public methods
  public async get<T = any>(url: string, config?: any): Promise<T> {
    const response = await this.client.get(url, config);
    return response.data;
  }

  public async post<T = any>(url: string, data?: any, config?: any): Promise<T> {
    const response = await this.client.post(url, data, config);
    return response.data;
  }

  public async put<T = any>(url: string, data?: any, config?: any): Promise<T> {
    const response = await this.client.put(url, data, config);
    return response.data;
  }

  public async delete<T = any>(url: string, config?: any): Promise<T> {
    const response = await this.client.delete(url, config);
    return response.data;
  }

  public async patch<T = any>(url: string, data?: any, config?: any): Promise<T> {
    const response = await this.client.patch(url, data, config);
    return response.data;
  }
}

export const apiClient = new ApiClient();
