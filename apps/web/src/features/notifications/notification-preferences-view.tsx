'use client';
import { useTranslation } from 'react-i18next';

import { ArrowLeft, SlidersHorizontal, Bell, Mail, MessageSquare, Smartphone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/services/api.client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SelectMenu } from '@/components/ui/select-menu';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

interface Preference {
  category: string;
  inApp: boolean;
  email: boolean;
  sms: boolean;
  push: boolean;
  minSeverity: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  alarm: 'Alarms', production: 'Production', quality: 'Quality',
  maintenance: 'Maintenance', downtime: 'Downtime', energy: 'Energy',
  inventory: 'Inventory', system: 'System',
};

const SEVERITY_OPTS = [
  { value: 'info',     label: 'Info & above'     },
  { value: 'warning',  label: 'Warning & above'  },
  { value: 'error',    label: 'Error & above'    },
  { value: 'critical', label: 'Critical only'    },
];

const CHANNELS: { key: keyof Pick<Preference, 'inApp' | 'email' | 'sms' | 'push'>; label: string; icon: typeof Bell }[] = [
  { key: 'inApp', label: 'In-App', icon: Bell },
  { key: 'email', label: 'Email',  icon: Mail },
  { key: 'sms',   label: 'SMS',    icon: MessageSquare },
  { key: 'push',  label: 'Push',   icon: Smartphone },
];

export function NotificationPreferencesView() {
  const { t } = useTranslation('modules');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => api.get<Preference[]>('/notifications/preferences'),
  });

  const mutation = useMutation({
    mutationFn: (pref: Partial<Preference> & { category: string }) =>
      api.put('/notifications/preferences', pref),
    onMutate: async (pref) => {
      await queryClient.cancelQueries({ queryKey: ['notifications', 'preferences'] });
      const prev = queryClient.getQueryData<Preference[]>(['notifications', 'preferences']);
      queryClient.setQueryData<Preference[]>(['notifications', 'preferences'], (old) =>
        (old ?? []).map((p) => (p.category === pref.category ? { ...p, ...pref } : p)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['notifications', 'preferences'], ctx.prev);
      toast({ title: 'Failed to save preference', variant: 'destructive' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications', 'preferences'] }),
  });

  const prefs = data ?? [];

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push('/notifications')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2.5">
            <SlidersHorizontal className="w-6 h-6 text-primary" />
            {t('notifications.preferences')}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Choose how you want to be notified for each category of event.
          </p>
        </div>
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-[1.4fr_repeat(4,0.6fr)_1.2fr] gap-2 px-4 py-3 border-b border-border/60 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Category</span>
          {CHANNELS.map((c) => (
            <span key={c.key} className="text-center">{c.label}</span>
          ))}
          <span className="text-center">Min. severity</span>
        </div>

        {isLoading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Loading preferences…</div>
        ) : (
          prefs.map((p) => (
            <div
              key={p.category}
              className="grid grid-cols-[1.4fr_repeat(4,0.6fr)_1.2fr] gap-2 px-4 py-3 border-b border-border/40 items-center hover:bg-foreground/[0.02]"
            >
              <span className="text-sm font-medium">{CATEGORY_LABELS[p.category] ?? p.category}</span>
              {CHANNELS.map((c) => (
                <div key={c.key} className="flex justify-center">
                  <Checkbox
                    checked={p[c.key]}
                    onCheckedChange={(v) =>
                      mutation.mutate({ category: p.category, [c.key]: v === true })
                    }
                  />
                </div>
              ))}
              <div className="flex justify-center">
                <SelectMenu
                  size="sm"
                  value={p.minSeverity}
                  onValueChange={(v) => mutation.mutate({ category: p.category, minSeverity: v })}
                  options={SEVERITY_OPTS}
                />
              </div>
            </div>
          ))
        )}
      </div>

      <p className={cn('text-xs text-muted-foreground')}>
        In-App notifications appear in the bell and on this page. Email/SMS/Push require the
        relevant channel to be configured by your administrator.
      </p>
    </div>
  );
}
