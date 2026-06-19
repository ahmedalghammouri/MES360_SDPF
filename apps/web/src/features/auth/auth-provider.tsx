'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth-store';
import { authService } from '@/services/auth.service';

const isPublicRoute = (pathname: string) =>
  pathname === '/' ||
  pathname.startsWith('/login') ||
  pathname.startsWith('/forgot-password') ||
  pathname.startsWith('/reset-password');

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, accessToken, refreshToken, setAuth, logout } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const refreshAttempted = useRef(false);

  // Wait for Zustand persist to finish hydrating from localStorage before
  // running the route guard. Without this, opening a new tab briefly sees
  // isAuthenticated=false (pre-hydration default), triggers a redirect to /,
  // and the / guard then bounces to /dashboard.
  // NOTE: useState initializer runs on the server (SSR) where localStorage /
  // persist API don't exist — keep it false and check inside useEffect only.
  const [storeHydrated, setStoreHydrated] = useState(false);
  useEffect(() => {
    const p = useAuthStore.persist;
    if (!p) { setStoreHydrated(true); return; }
    if (p.hasHydrated()) { setStoreHydrated(true); return; }
    const unsub = p.onFinishHydration(() => setStoreHydrated(true));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!storeHydrated) return;

    const isPublic = isPublicRoute(pathname);

    if (isAuthenticated && isPublic) {
      refreshAttempted.current = false;
      router.replace('/apps');
      return;
    }

    if (!isAuthenticated && !isPublic) {
      if (!refreshAttempted.current && refreshToken) {
        refreshAttempted.current = true;
        authService
          .refreshToken(refreshToken)
          .then((data) => {
            if (data) {
              setAuth(data.user, data.accessToken, data.refreshToken);
            } else {
              router.replace('/');
            }
          })
          .catch(() => {
            router.replace('/');
          });
      } else {
        router.replace('/');
      }
    }
  }, [isAuthenticated, pathname, router, setAuth, logout, refreshToken, storeHydrated]);

  useEffect(() => {
    if (!accessToken || !refreshToken) return;

    const decoded = parseJwt(accessToken);
    if (!decoded) return;

    const expiresAt = decoded.exp * 1000;
    const refreshAt = expiresAt - 60 * 1000;
    const delay = refreshAt - Date.now();

    if (delay <= 0) return;

    const timer = setTimeout(() => {
      authService
        .refreshToken(refreshToken)
        .then((data) => {
          if (data) setAuth(data.user, data.accessToken, data.refreshToken);
          else {
            logout();
            router.replace('/');
          }
        })
        .catch(() => {
          logout();
          router.replace('/');
        });
    }, delay);

    return () => clearTimeout(timer);
  }, [accessToken, refreshToken, setAuth, logout]);

  return <>{children}</>;
}

function parseJwt(token: string): { exp: number } | null {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(window.atob(base64));
  } catch {
    return null;
  }
}
