'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth-store';
import { FactorySelector } from '@/features/factory-selector/factory-selector';

export default function RootPage() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/apps');
    }
  }, [isAuthenticated, router]);

  if (isAuthenticated) return null;

  return <FactorySelector />;
}
