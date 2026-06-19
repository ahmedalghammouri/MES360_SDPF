'use client';
import { useTranslation } from 'react-i18next';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Settings, Plus, Pencil, Trash2, Zap, BellOff } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';

import { api } from '@/services/api.client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { SelectMenu } from '@/components/ui/select-menu';
import { FormDialog } from '@/components/ui/form-dialog';
import { DeleteDialog } from '@/components/ui/delete-dialog';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

// ── Static option sets ──────────────────────────────────────────

const EVENT_OPTS = [
  { value: 'production.work-order.started', label: 'Production · Work order started' },
  { value: 'production.work-order.held',    label: 'Production · Work order on hold' },
  { value: 'downtime.event.created',        label: 'Downtime · Unplanned downtime' },
  { value: 'downtime.auto.created',         label: 'Downtime · Auto-detected' },
  { value: 'quality.inspection.failed',     label: 'Quality · Inspection failed' },
  { value: 'quality.ncr.created',           label: 'Quality · NCR raised' },
  { value: 'quality.ncr.critical',          label: 'Quality · Critical NCR' },
  { value: 'maintenance.wo.created',        label: 'Maintenance · Emergency WO' },
  { value: 'machine.state.changed',         label: 'Machine · Breakdown' },
];

const CHANNEL_OPTS = [
  { key: 'in_app', label: 'In-App' },
  { key: 'email',  label: 'Email' },
  { key: 'sms',    label: 'SMS' },
  { key: 'push',   label: 'Push' },
];

const ROLE_OPTS = [
  'SUPER_ADMIN', 'FACTORY_ADMIN', 'PLANT_MANAGER', 'PRODUCTION_MANAGER',
  'PRODUCTION_SUPERVISOR', 'QUALITY_MANAGER', 'QUALITY_ENGINEER',
  'MAINTENANCE_MANAGER', 'MAINTENANCE_TECHNICIAN', 'ENERGY_MANAGER',
  'OPERATOR', 'VIEWER',
];

function roleLabel(r: string) {
  return r.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Types ───────────────────────────────────────────────────────

interface Rule {
  id: string;
  name: string;
  module: string;
  event: string;
  channels: string[];
  recipients: { userIds?: string[]; roles?: string[] };
  isActive: boolean;
}

interface RuleForm {
  id?: string;
  name: string;
  eventType: string;
  channels: string[];
  recipientRoles: string[];
  isActive: boolean;
}

const EMPTY_FORM: RuleForm = {
  name: '', eventType: EVENT_OPTS[0].value, channels: ['in_app'], recipientRoles: [], isActive: true,
};

// ── Component ───────────────────────────────────────────────────

export function NotificationRulesView() {
  const { t } = useTranslation('modules');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [form, setForm] = useState<RuleForm | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['notification-rules'],
    queryFn: () => api.get<Rule[]>('/notifications/rules'),
    retry: false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notification-rules'] });

  const saveMutation = useMutation({
    mutationFn: (f: RuleForm) => {
      const body = {
        name: f.name,
        eventType: f.eventType,
        channels: f.channels,
        recipientRoles: f.recipientRoles,
        isActive: f.isActive,
      };
      return f.id
        ? api.patch(`/notifications/rules/${f.id}`, body)
        : api.post('/notifications/rules', body);
    },
    onSuccess: () => {
      invalidate();
      setForm(null);
      toast({ title: 'Rule saved', variant: 'success' });
    },
    onError: () => toast({ title: 'Failed to save rule', variant: 'destructive' }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/notifications/rules/${id}`, { isActive }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/rules/${id}`),
    onSuccess: () => {
      invalidate();
      setDeleteId(null);
      toast({ title: 'Rule deleted' });
    },
    onError: () => toast({ title: 'Failed to delete rule', variant: 'destructive' }),
  });

  const rules = data ?? [];
  const forbidden = (error as AxiosError)?.response?.status === 403;

  function openEdit(r: Rule) {
    setForm({
      id: r.id,
      name: r.name,
      eventType: `${r.module}.${r.event}`,
      channels: r.channels ?? ['in_app'],
      recipientRoles: r.recipients?.roles ?? [],
      isActive: r.isActive,
    });
  }

  function toggleArray(arr: string[], value: string): string[] {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
  }

  const formValid = !!form && form.name.trim().length >= 3 && form.channels.length > 0;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push('/notifications')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2.5">
              <Settings className="w-6 h-6 text-primary" />
              {t('notifications.rules')}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Route events to specific channels and roles. Rules override the built-in defaults.
            </p>
          </div>
        </div>
        {!forbidden && (
          <Button size="sm" onClick={() => setForm({ ...EMPTY_FORM })} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> New Rule
          </Button>
        )}
      </div>

      {/* Inline create/edit form */}
      {form && (
        <FormDialog
          open={!!form}
          onClose={() => setForm(null)}
          title={form.id ? 'Edit Rule' : 'New Notification Rule'}
          onSubmit={() => saveMutation.mutate(form)}
          isSubmitting={saveMutation.isPending}
          isValid={formValid}
        >
          <div className="space-y-4">
            <div>
              <Label>Rule name</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Alert quality team on critical NCR"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div>
              <Label>Trigger event</Label>
              <SelectMenu
                size="md" fullWidth className="mt-1"
                value={form.eventType}
                onValueChange={(v) => setForm({ ...form, eventType: v })}
                options={EVENT_OPTS}
              />
            </div>

            <div>
              <Label>Channels</Label>
              <div className="flex flex-wrap gap-3 mt-2">
                {CHANNEL_OPTS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={form.channels.includes(c.key)}
                      onCheckedChange={() => setForm({ ...form, channels: toggleArray(form.channels, c.key) })}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Label>Recipient roles</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                {ROLE_OPTS.map((r) => (
                  <label key={r} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={form.recipientRoles.includes(r)}
                      onCheckedChange={() => setForm({ ...form, recipientRoles: toggleArray(form.recipientRoles, r) })}
                    />
                    {roleLabel(r)}
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Leave empty to fall back to the built-in default recipients for this event.
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={form.isActive}
                onCheckedChange={(v) => setForm({ ...form, isActive: v === true })}
              />
              Active
            </label>
          </div>
        </FormDialog>
      )}

      {/* List */}
      {forbidden ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <BellOff className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
          <div className="font-semibold text-foreground/70">No permission</div>
          <div className="text-sm text-muted-foreground mt-1">
            You need the <code>notifications:manage</code> permission to manage rules.
          </div>
        </div>
      ) : isLoading ? (
        <div className="glass-card rounded-xl p-12 text-center text-sm text-muted-foreground">Loading rules…</div>
      ) : rules.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <Zap className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
          <div className="font-semibold text-foreground/70">No custom rules yet</div>
          <div className="text-sm text-muted-foreground mt-1">
            Built-in defaults still apply. Add a rule to customise channels or recipients.
          </div>
        </div>
      ) : (
        <div className="glass-card rounded-xl overflow-hidden divide-y divide-border/50">
          {rules.map((r) => (
            <div key={r.id} className="flex items-start gap-4 p-4 group">
              <button
                onClick={() => toggleMutation.mutate({ id: r.id, isActive: !r.isActive })}
                className={cn(
                  'mt-1 w-9 h-5 rounded-full relative transition-colors shrink-0',
                  r.isActive ? 'bg-primary' : 'bg-muted',
                )}
                title={r.isActive ? 'Active — click to disable' : 'Disabled — click to enable'}
              >
                <span className={cn(
                  'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all',
                  r.isActive ? 'left-[18px]' : 'left-0.5',
                )} />
              </button>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">{r.name}</div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <Badge variant="outline" className="text-[10px] font-mono">{r.module}.{r.event}</Badge>
                  {(r.channels ?? []).map((c) => (
                    <Badge key={c} className="text-[10px] bg-brand-500/10 text-brand-400 border-brand-500/30 border">{c}</Badge>
                  ))}
                  {(r.recipients?.roles ?? []).map((role) => (
                    <Badge key={role} variant="secondary" className="text-[10px]">{roleLabel(role)}</Badge>
                  ))}
                  {(r.recipients?.roles ?? []).length === 0 && (
                    <span className="text-[10px] text-muted-foreground italic">default recipients</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}>
                  <Pencil size={13} />
                </Button>
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => setDeleteId(r.id)}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <DeleteDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        title="Delete notification rule"
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}
