import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const ACCESS_TOKEN_KEY = 'klassic_access_token';
const REFRESH_TOKEN_KEY = 'klassic_refresh_token';

/**
 * Secure token storage using Expo SecureStore
 * Falls back to AsyncStorage on web (less secure)
 */
class TokenStorage {
  async setAccessToken(token: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        // Web fallback (not as secure)
        localStorage.setItem(ACCESS_TOKEN_KEY, token);
      } else {
        await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, token);
      }
    } catch (error) {
      console.error('Failed to save access token:', error);
      throw error;
    }
  }

  async getAccessToken(): Promise<string | null> {
    try {
      if (Platform.OS === 'web') {
        return localStorage.getItem(ACCESS_TOKEN_KEY);
      } else {
        return await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
      }
    } catch (error) {
      console.error('Failed to get access token:', error);
      return null;
    }
  }

  async setRefreshToken(token: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        localStorage.setItem(REFRESH_TOKEN_KEY, token);
      } else {
        await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
      }
    } catch (error) {
      console.error('Failed to save refresh token:', error);
      throw error;
    }
  }

  async getRefreshToken(): Promise<string | null> {
    try {
      if (Platform.OS === 'web') {
        return localStorage.getItem(REFRESH_TOKEN_KEY);
      } else {
        return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      }
    } catch (error) {
      console.error('Failed to get refresh token:', error);
      return null;
    }
  }

  async clearTokens(): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
      } else {
        await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
        await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
      }
    } catch (error) {
      console.error('Failed to clear tokens:', error);
      throw error;
    }
  }

  async hasTokens(): Promise<boolean> {
    const accessToken = await this.getAccessToken();
    return accessToken !== null;
  }
}

export const tokenStorage = new TokenStorage();
