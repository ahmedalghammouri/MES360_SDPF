'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTheme } from 'next-themes';
import { useMutation } from '@tanstack/react-query';
import {
  Settings, User, Shield, Bell, Globe, Database, Palette, Key, CheckCircle,
  QrCode, ShieldAlert, Loader2, Monitor, Moon, Sun, ExternalLink,
} from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectMenu } from '@/components/ui/select-menu';
import { Separator } from '@/components/ui/separator';
import { useTranslation } from 'react-i18next';
import { setLocale } from '@/lib/use-locale';
import { useAuthStore } from '@/store/auth-store';
import { authService } from '@/services/auth.service';
import { api } from '@/services/api.client';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { SystemDangerZone } from './system-danger-zone';

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: z.string().min(8, 'Minimum 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

type PasswordFormData = z.infer<typeof passwordSchema>;

export function SettingsView() {
  const { user, setUser } = useAuthStore();
  const { t } = useTranslation('settings');
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [activeSection, setActiveSection] = useState('profile');
  const [mfaSetupData] = useState<{ qrCode: string; secret: string } | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  // Profile form state
  const [name, setName] = useState(user?.name ?? '');
  const [nameAr, setNameAr] = useState(user?.nameAr ?? '');
  const [department, setDepartment] = useState(user?.department ?? '');
  const [jobTitle, setJobTitle] = useState(user?.jobTitle ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');

  // Notification channels (real user fields)
  const [notifyEmail, setNotifyEmail] = useState<boolean>((user as any)?.notifyEmail ?? true);
  const [notifyWhatsapp, setNotifyWhatsapp] = useState<boolean>((user as any)?.notifyWhatsapp ?? false);
  const [notifySMS, setNotifySMS] = useState<boolean>((user as any)?.notifySMS ?? false);

  // Language & region
  const [language, setLanguage] = useState(user?.language ?? 'en');
  const [timeZone, setTimeZone] = useState(user?.timezone ?? 'Asia/Riyadh');
  const [dateFormat, setDateFormat] = useState('DD/MM/YYYY');
  const [numberFormat, setNumberFormat] = useState('1,234.56');

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      setDateFormat(localStorage.getItem('pref.dateFormat') ?? 'DD/MM/YYYY');
      setNumberFormat(localStorage.getItem('pref.numberFormat') ?? '1,234.56');
    }
  }, []);

  const SECTIONS = [
    { id: 'profile', label: t('sections.profile'), icon: User },
    { id: 'security', label: t('sections.security'), icon: Shield },
    { id: 'notifications', label: t('sections.notifications'), icon: Bell },
    { id: 'language', label: t('sections.language'), icon: Globe },
    { id: 'appearance', label: t('sections.appearance'), icon: Palette },
    { id: 'integrations', label: t('sections.integrations'), icon: Database },
    { id: 'system', label: t('sections.system'), icon: ShieldAlert },
  ];

  const {
    register, handleSubmit, reset,
    formState: { errors, isSubmitting },
  } = useForm<PasswordFormData>({ resolver: zodResolver(passwordSchema) });

  // Generic profile save → PATCH /users/me, then sync the auth store.
  const saveProfile = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch<any>('/users/me', patch),
    onSuccess: (updated) => {
      if (user) setUser({ ...user, ...updated });
      toast({ title: 'Saved', description: 'Your settings have been updated.' });
    },
    onError: (e: any) => {
      toast({ variant: 'destructive', title: 'Save failed', description: e?.response?.data?.message ?? 'Please try again.' });
    },
  });

  const handlePasswordChange = async (data: PasswordFormData) => {
    try {
      await authService.changePassword(data.currentPassword, data.newPassword);
      toast({ title: 'Password changed', description: 'Your password has been updated successfully.' });
      reset();
      setChangingPassword(false);
    } catch {
      toast({ title: 'Error', description: 'Current password is incorrect.', variant: 'destructive' });
    }
  };

  const saveRegion = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('pref.dateFormat', dateFormat);
      localStorage.setItem('pref.numberFormat', numberFormat);
    }
    saveProfile.mutate({ language, timezone: timeZone });
  };

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t('subtitle')}</p>
      </div>

      <div className="flex gap-6">
        <div className="w-48 shrink-0">
          <nav className="space-y-1">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              const isDanger = section.id === 'system';
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left',
                    activeSection === section.id
                      ? isDanger ? 'bg-red-500/15 text-red-400' : 'bg-brand-600/20 text-brand-300'
                      : isDanger ? 'text-red-400/70 hover:text-red-400 hover:bg-red-500/5' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5',
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {section.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex-1 glass-card rounded-xl p-6">
          {activeSection === 'profile' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Profile Information</h2>
                <p className="text-sm text-muted-foreground">Update your personal details</p>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Full Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Name (Arabic)</Label>
                  <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Email Address</Label>
                  <Input defaultValue={user?.email || ''} disabled />
                  <p className="text-xs text-muted-foreground">Email cannot be changed. Contact admin.</p>
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Input defaultValue={user?.role || ''} disabled />
                </div>
                <div className="space-y-2">
                  <Label>Department</Label>
                  <Input value={department} onChange={(e) => setDepartment(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Job Title</Label>
                  <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
              </div>
              <Button onClick={() => saveProfile.mutate({ name, nameAr, department, jobTitle, phone })} disabled={saveProfile.isPending}>
                {saveProfile.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : 'Save Changes'}
              </Button>
            </div>
          )}

          {activeSection === 'security' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Security Settings</h2>
                <p className="text-sm text-muted-foreground">Manage your password and two-factor authentication</p>
              </div>
              <Separator />

              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Change Password</h3>
                {!changingPassword ? (
                  <Button variant="outline" onClick={() => setChangingPassword(true)}>
                    <Key className="w-4 h-4 mr-2" />
                    Change Password
                  </Button>
                ) : (
                  <form onSubmit={handleSubmit(handlePasswordChange)} className="space-y-3 max-w-sm">
                    <div className="space-y-2">
                      <Label>Current Password</Label>
                      <Input type="password" {...register('currentPassword')} />
                      {errors.currentPassword && <p className="text-xs text-destructive">{errors.currentPassword.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label>New Password</Label>
                      <Input type="password" {...register('newPassword')} />
                      {errors.newPassword && <p className="text-xs text-destructive">{errors.newPassword.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label>Confirm New Password</Label>
                      <Input type="password" {...register('confirmPassword')} />
                      {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? 'Updating...' : 'Update Password'}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => { setChangingPassword(false); reset(); }}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </div>

              <Separator />

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">Two-Factor Authentication</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Add an extra layer of security using an authenticator app
                    </p>
                  </div>
                  {user?.mfaEnabled ? (
                    <div className="flex items-center gap-2 text-green-400 text-sm">
                      <CheckCircle className="w-4 h-4" />
                      Enabled
                    </div>
                  ) : (
                    <Button size="sm" disabled onClick={() => toast({ title: 'Coming soon', description: 'MFA enrollment is not available yet.' })}>
                      <QrCode className="w-4 h-4 mr-2" />
                      Setup MFA
                    </Button>
                  )}
                </div>

                {mfaSetupData && (
                  <div className="bg-foreground/5 rounded-lg p-4 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
                    </p>
                    <div className="w-48 h-48 bg-white rounded-lg flex items-center justify-center">
                      <img src={mfaSetupData.qrCode} alt="MFA QR Code" className="w-44 h-44" />
                    </div>
                    <div>
                      <Label className="text-xs">Manual Entry Key</Label>
                      <Input value={mfaSetupData.secret} readOnly className="font-mono text-xs mt-1" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeSection === 'notifications' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Notification Channels</h2>
                <p className="text-sm text-muted-foreground">Choose how you receive alerts. For per-event rules, use Notification Preferences.</p>
              </div>
              <Separator />
              <div className="space-y-4 max-w-lg">
                {[
                  { label: 'Email', desc: 'Receive notifications by email', val: notifyEmail, set: setNotifyEmail },
                  { label: 'WhatsApp', desc: 'Receive notifications on WhatsApp', val: notifyWhatsapp, set: setNotifyWhatsapp },
                  { label: 'SMS', desc: 'Receive notifications by SMS', val: notifySMS, set: setNotifySMS },
                ].map((pref) => (
                  <div key={pref.label} className="flex items-center justify-between py-1.5">
                    <div>
                      <div className="text-sm font-medium">{pref.label}</div>
                      <div className="text-xs text-muted-foreground">{pref.desc}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => pref.set(!pref.val)}
                      className={cn('relative w-10 h-5 rounded-full transition-colors', pref.val ? 'bg-brand-600' : 'bg-foreground/20')}
                    >
                      <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform', pref.val ? 'translate-x-5' : 'translate-x-0.5')} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={() => saveProfile.mutate({ notifyEmail, notifyWhatsapp, notifySMS })} disabled={saveProfile.isPending}>
                  {saveProfile.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : 'Save Channels'}
                </Button>
                <Link href="/notifications/preferences" className="text-sm text-brand-400 hover:underline inline-flex items-center gap-1">
                  Advanced rules <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          )}

          {activeSection === 'language' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Language & Region</h2>
                <p className="text-sm text-muted-foreground">Configure display language and regional settings</p>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-4 max-w-md">
                <div className="space-y-2">
                  <Label>{t('language.interfaceLanguage')}</Label>
                  <SelectMenu size="md" fullWidth value={language} onValueChange={(v) => { setLanguage(v as 'en' | 'ar'); setLocale(v as 'en' | 'ar'); }}
                    options={[{ value: 'en', label: 'English' }, { value: 'ar', label: 'العربية (Arabic)' }]} />
                </div>
                <div className="space-y-2">
                  <Label>Date Format</Label>
                  <SelectMenu size="md" fullWidth value={dateFormat} onValueChange={setDateFormat}
                    options={[{ value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' }, { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' }, { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' }]} />
                </div>
                <div className="space-y-2">
                  <Label>Time Zone</Label>
                  <SelectMenu size="md" fullWidth value={timeZone} onValueChange={setTimeZone}
                    options={[{ value: 'Asia/Riyadh', label: 'Asia/Riyadh (UTC+3)' }, { value: 'UTC', label: 'UTC' }, { value: 'Africa/Cairo', label: 'Africa/Cairo (UTC+2)' }]} />
                </div>
                <div className="space-y-2">
                  <Label>Number Format</Label>
                  <SelectMenu size="md" fullWidth value={numberFormat} onValueChange={setNumberFormat}
                    options={[{ value: '1,234.56', label: '1,234.56' }, { value: '1.234,56', label: '1.234,56' }]} />
                </div>
              </div>
              <Button onClick={saveRegion} disabled={saveProfile.isPending}>
                {saveProfile.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : 'Save Settings'}
              </Button>
            </div>
          )}

          {activeSection === 'appearance' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Appearance</h2>
                <p className="text-sm text-muted-foreground">Choose how the interface looks</p>
              </div>
              <Separator />
              <div className="space-y-3">
                <Label>Theme</Label>
                <div className="grid grid-cols-3 gap-3 max-w-md">
                  {[
                    { value: 'light', label: 'Light', icon: Sun },
                    { value: 'dark', label: 'Dark', icon: Moon },
                    { value: 'system', label: 'System', icon: Monitor },
                  ].map((opt) => {
                    const Icon = opt.icon;
                    const active = mounted && theme === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setTheme(opt.value)}
                        className={cn('flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors',
                          active ? 'border-brand-500 bg-brand-500/10 text-brand-300' : 'border-border/60 hover:border-border text-muted-foreground hover:text-foreground')}
                      >
                        <Icon className="w-5 h-5" />
                        <span className="text-sm">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeSection === 'integrations' && (
            <div className="py-12 text-center text-muted-foreground">
              <Settings className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <div className="font-medium">Coming soon</div>
              <div className="text-sm mt-1">This settings section is under development</div>
            </div>
          )}

          {activeSection === 'system' && <SystemDangerZone />}
        </div>
      </div>
    </div>
  );
}
