import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';

import { useAuthStore } from '@/store/auth-store';

// Resolve the API base so it works from ANY device on the LAN (desktop + phone).
// The app is served behind nginx (which proxies /api/ to the backend), so in the
// browser we always call SAME-ORIGIN — requests go to whatever host:port served
// the page (e.g. http://10.94.130.16:8080), never a hard-coded localhost that
// would resolve to the visitor's own device. An explicit non-localhost
// NEXT_PUBLIC_API_URL (a real domain) still wins; SSR falls back to the env/port.
function resolveApiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (env && !/localhost|127\.0\.0\.1/i.test(env)) return env; // real external domain
  if (typeof window !== 'undefined') return '';                // browser → same-origin
  return env || 'http://localhost:3001';                       // SSR / build fallback
}
const API_URL = resolveApiBase();
const API_VERSION = '/api/v1';

export const apiClient: AxiosInstance = axios.create({
  baseURL: `${API_URL}${API_VERSION}`,
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// Request interceptor — inject auth token
apiClient.interceptors.request.use(
  (config) => {
    const { accessToken } = useAuthStore.getState();
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor — unwrap envelope + handle 401 + token refresh
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    // Unwrap standard API envelope: { success, data, timestamp } → data
    if (response.data && typeof response.data === 'object' && 'success' in response.data && 'data' in response.data) {
      response.data = response.data.data;
    }
    return response;
  },
  async (error) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const { refreshToken, setTokens, logout } = useAuthStore.getState();

      if (refreshToken) {
        try {
          const response = await axios.post<{ success: boolean; data: { accessToken: string; refreshToken: string } }>(
            `${API_URL}${API_VERSION}/auth/refresh`,
            { refreshToken },
          );
          const { accessToken: newAccess, refreshToken: newRefresh } = response.data.data ?? response.data;
          setTokens(newAccess, newRefresh);
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newAccess}`;
          }
          return apiClient(originalRequest);
        } catch {
          logout();
        }
      } else {
        logout();
      }
    }

    return Promise.reject(error);
  },
);

// Generic request helpers
export const api = {
  get: <T>(url: string, config?: AxiosRequestConfig) =>
    apiClient.get<T>(url, config).then((r) => r.data),

  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    apiClient.post<T>(url, data, config).then((r) => r.data),

  put: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    apiClient.put<T>(url, data, config).then((r) => r.data),

  patch: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    apiClient.patch<T>(url, data, config).then((r) => r.data),

  delete: <T>(url: string, config?: AxiosRequestConfig) =>
    apiClient.delete<T>(url, config).then((r) => r.data),
};
