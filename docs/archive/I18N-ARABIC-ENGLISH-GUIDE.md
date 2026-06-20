# Internationalization Guide — Arabic + English (RTL/LTR)

How to take MES360° from English-only to a fully bilingual (العربية / English) app with
live language switching and proper right-to-left (RTL) layout. This guide is written
against **this** codebase (Next.js 15 App Router, `apps/web`).

---

## 0. Where we are today (starting point)

| Thing | Current state |
|-------|---------------|
| i18n libraries | `i18next`, `react-i18next`, `next-i18next` are in `package.json` but **unused** (no init, no `useTranslation`, no translation files). |
| Locale source of truth | `user.language: 'en' \| 'ar'` in the auth store (`apps/web/src/store/auth-store.ts`), saved via `PATCH /users/me` from **Settings → Language & Region**. |
| `<html>` | `apps/web/src/app/layout.tsx` hardcodes `lang="en"`, no `dir`. |
| RTL | No Tailwind RTL plugin; layout uses physical classes (`pl-*`, `ml-*`, `left-*`). |
| Arabic data | Several DB entities already have a `nameAr` column (used in factory selector, master-data-select). |
| UI strings | Hardcoded English literals throughout `src/features/**` and `src/components/**`. |

**Decision:** keep locale **non-routed** (no `/en` `/ar` URL prefixes). The app stores
locale in the user profile and is almost entirely client components, so a client-side
**`react-i18next`** setup (libraries already installed) is the right fit. We mirror the
locale to a **cookie** so the server can render the correct `lang`/`dir` on first paint
(no flash, no hydration mismatch). `next-i18next` is a Pages-Router package — **ignore/remove it**.

> Alternative (only if you later need SEO-friendly per-language URLs or full RTL SSR):
> migrate to `next-intl` with a `[locale]` route segment. That's a bigger refactor;
> not recommended for the current single-shell app.

---

## 1. Architecture at a glance

```
cookie "locale" ──┐                        ┌─→ <html lang dir>   (server, root layout)
                  ├─ source of truth ──────┤
user.language ────┘   (synced both ways)   └─→ i18next instance  (client, react-i18next)
                                                   │
                                       useTranslation() → t('namespace:key')
```

- **Cookie `locale`** = what the *server* reads to set `<html lang/dir>` before JS loads.
- **`user.language`** = persisted preference (DB). On login / profile change we copy it into the cookie.
- **i18next** = the runtime translator on the client. Switching language updates i18next,
  the cookie, `<html>`, and (when logged in) the user profile.

---

## 2. Step-by-step setup

### 2.1 Translation file structure

Create namespaced JSON dictionaries (split by domain so files stay reviewable):

```
apps/web/src/locales/
  en/
    common.json        # buttons, shared labels, statuses
    nav.json           # sidebar / topbar / apps launcher
    production.json
    quality.json
    maintenance.json
    inventory.json
    settings.json
    ...
  ar/
    common.json
    nav.json
    ...
```

`common.json` (en):
```json
{
  "actions": { "save": "Save", "cancel": "Cancel", "delete": "Delete", "edit": "Edit", "create": "Create" },
  "status": { "active": "Active", "paused": "Paused", "archived": "Archived" }
}
```
`common.json` (ar):
```json
{
  "actions": { "save": "حفظ", "cancel": "إلغاء", "delete": "حذف", "edit": "تعديل", "create": "إنشاء" },
  "status": { "active": "نشط", "paused": "متوقف", "archived": "مؤرشف" }
}
```

**Key naming convention:** `namespace:section.item` — lowercase, dot-nested, stable.
Never put a sentence as a key. Reuse `common:*` aggressively.

### 2.2 The i18next instance — `apps/web/src/lib/i18n.ts`

```ts
'use client';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enCommon from '@/locales/en/common.json';
import arCommon from '@/locales/ar/common.json';
import enNav from '@/locales/en/nav.json';
import arNav from '@/locales/ar/nav.json';
// …import the rest per namespace

export const SUPPORTED = ['en', 'ar'] as const;
export type Locale = (typeof SUPPORTED)[number];
export const RTL_LOCALES: Locale[] = ['ar'];
export const dirOf = (l: string): 'rtl' | 'ltr' => (RTL_LOCALES.includes(l as Locale) ? 'rtl' : 'ltr');

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: {
      en: { common: enCommon, nav: enNav /* … */ },
      ar: { common: arCommon, nav: arNav /* … */ },
    },
    lng: 'en',                 // overridden by the provider on mount
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'nav' /* … */],
    interpolation: { escapeValue: false }, // React already escapes
    returnEmptyString: false,
  });
}
export default i18n;
```

### 2.3 Cookie + `<html>` on the server — `apps/web/src/app/layout.tsx`

Make the root layout read the cookie and set `lang`/`dir` so the very first server render
is correct (prevents an English→Arabic flash and `dir` hydration mismatch):

```tsx
import { cookies } from 'next/headers';
const dirOf = (l?: string) => (l === 'ar' ? 'rtl' : 'ltr');

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = cookies().get('locale')?.value ?? 'en';
  return (
    <html lang={locale} dir={dirOf(locale)} suppressHydrationWarning
          className={`${GeistSans.variable} ${GeistMono.variable} ${arabicFont.variable}`}>
      <body className="min-h-screen bg-background font-sans antialiased">{children}</body>
    </html>
  );
}
```

### 2.4 A LocaleProvider — `apps/web/src/components/locale-provider.tsx`

Initializes i18next, keeps `<html>` and the cookie in sync, and follows `user.language`.
Mount it inside `apps/web/src/components/providers.tsx` (wrap `AuthProvider`'s children,
inside `ThemeProvider`):

```tsx
'use client';
import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n, { dirOf, type Locale } from '@/lib/i18n';
import { useAuthStore } from '@/store/auth-store';

function applyLocale(locale: Locale) {
  if (i18n.language !== locale) i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = dirOf(locale);
  document.cookie = `locale=${locale}; path=/; max-age=31536000; samesite=lax`;
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const lang = useAuthStore((s) => s.user?.language);
  useEffect(() => {
    const cookie = document.cookie.match(/(?:^|; )locale=(\w+)/)?.[1] as Locale | undefined;
    applyLocale((lang as Locale) ?? cookie ?? 'en');
  }, [lang]);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
```

Expose a tiny switch helper used by the Settings selector and any quick toggle:
```ts
// apps/web/src/lib/use-locale.ts
import i18n, { dirOf, type Locale } from '@/lib/i18n';
export function setLocale(locale: Locale) {
  i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = dirOf(locale);
  document.cookie = `locale=${locale}; path=/; max-age=31536000; samesite=lax`;
}
```

### 2.5 Wire the existing Settings switcher to change language live

In `apps/web/src/features/settings/settings-view.tsx`, the **Language & Region** tab already
has a language `SelectMenu` bound to `language` and saves via `saveProfile.mutate({ language, timezone })`.
Make it switch **immediately** (not only on Save):

```tsx
import { setLocale } from '@/lib/use-locale';
// in the SelectMenu onValueChange:
onValueChange={(v) => { setLocale(v as 'en' | 'ar'); setLanguage(v as 'en' | 'ar'); }}
```
Keep the existing Save to persist it to the profile (`PATCH /users/me`). Optionally add a
quick globe toggle in the topbar that calls `setLocale` + persists.

### 2.6 Using translations in components

```tsx
'use client';
import { useTranslation } from 'react-i18next';

export function SaveButton() {
  const { t } = useTranslation();                 // defaultNS = 'common'
  return <Button>{t('actions.save')}</Button>;     // "Save" / "حفظ"
}

// other namespace:
const { t } = useTranslation('production');
t('orders.title');
```

---

## 3. RTL (right-to-left) — the layout half

Translating strings is only half the job; Arabic must mirror the layout.

### 3.1 Switch to logical Tailwind utilities
Replace **physical** direction classes with **logical** ones so they auto-flip with `dir`:

| Replace | With |
|---------|------|
| `pl-4` / `pr-4` | `ps-4` / `pe-4` |
| `ml-2` / `mr-2` | `ms-2` / `me-2` |
| `left-0` / `right-0` | `start-0` / `end-0` |
| `text-left` / `text-right` | `text-start` / `text-end` |
| `rounded-l-*` / `rounded-r-*` | `rounded-s-*` / `rounded-e-*` |
| `border-l` / `border-r` | `border-s` / `border-e` |

Tailwind 3.4 (this repo) supports `ps/pe/ms/me/start/end/text-start/...` natively. Do this
incrementally, file by file, starting with the shell (sidebar, topbar, app-shell).

> Optional helper: add `tailwindcss-rtl` or `tailwindcss-logical` if you prefer a plugin,
> but the built-in logical utilities are enough and have zero deps.

### 3.2 Flip directional icons
Chevrons/arrows that imply direction must mirror. Use a helper:
```tsx
const isRtl = document.documentElement.dir === 'rtl';
<ChevronRight className={isRtl ? 'rotate-180' : ''} />
```
Or read it reactively from i18n: `const { i18n } = useTranslation(); const isRtl = dirOf(i18n.language) === 'rtl';`

### 3.3 Things that DON'T flip automatically
- **Charts** (Recharts): set `reversed` on the X axis / legend alignment per `dir`.
- **Absolutely-positioned popovers, drawers, the dock** — audit `left/right`.
- **Icon-only buttons with `mr-2` spacing** inside labels → `me-2`.
- **Framer-motion x-offsets** (e.g. `x: 14`) — negate for RTL if they read as "from the side".

### 3.4 Fonts
Geist (current font) has weak Arabic coverage. Add an Arabic-capable font and apply it when
`dir=rtl`:
```ts
import { IBM_Plex_Sans_Arabic } from 'next/font/google';
export const arabicFont = IBM_Plex_Sans_Arabic({
  weight: ['400','500','600','700'], subsets: ['arabic'], variable: '--font-arabic',
});
```
In `globals.css`: `html[dir="rtl"] body { font-family: var(--font-arabic), var(--font-sans); }`

---

## 4. Dynamic data (DB content), numbers & dates

### 4.1 Bilingual DB fields
Many entities already carry `nameAr` alongside `name`. Render the right one:
```ts
// apps/web/src/lib/localized.ts
export function localizedName<T extends { name?: string|null; nameAr?: string|null }>(
  e: T | null | undefined, locale: string,
) {
  if (!e) return '';
  return (locale === 'ar' ? e.nameAr : e.name) || e.name || e.nameAr || '';
}
```
For entities **without** an `nameAr` column you want translated, add the column in Prisma
(`apps/api/prisma/schema.prisma`) + a migration, and expose it in the API DTOs.

### 4.2 Numbers, dates, currency — use `Intl`, not hardcoded formats
```ts
new Intl.NumberFormat(locale).format(1234.5);          // ١٬٢٣٤٫٥ vs 1,234.5
new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
```
If you use `date-fns`, import the `ar` locale and pass it. Centralize this in a
`useFormat()` hook keyed off `i18n.language` so the whole app is consistent. Note the existing
**Date Format / Number Format** prefs in Settings can feed this.

---

## 5. Backend (optional, phase 2)

The API is mostly locale-agnostic, but two areas benefit from Arabic:
- **Notifications / emails / alarm messages** — pick language from `user.language` (already on
  the `User` model) when composing. Store templates per locale.
- **Validation errors** — if you want Arabic API errors, send `Accept-Language` from the web
  client (axios default header) and localize messages server-side. Lower priority; most error
  text can be mapped to keys on the client instead.

No DB change is required to switch the UI language — locale lives client-side + the existing
`user.language`. Add `nameAr` columns only for the master-data you want translated.

---

## 6. Rollout plan (incremental, ship as you go)

1. **Foundation** (1 PR): §2.1–2.5 — i18n instance, provider, cookie + `<html>`, live switch in
   Settings. Add `common` + `nav` namespaces. Nothing else translated yet, but switching works
   and RTL flips `dir`.
2. **Shell RTL** (1 PR): convert sidebar, topbar, app-shell, dock, apps launcher to logical
   utilities (§3.1) + flip icons (§3.2) + Arabic font (§3.4). Now the frame looks right in Arabic.
3. **Per-feature passes** (N PRs): one feature module at a time — extract its hardcoded strings
   into a namespace, swap to `t(...)`, audit its RTL. Order by usage: Production → Quality →
   Maintenance → Inventory → IoT → Settings.
4. **Data layer**: apply `localizedName` + `Intl` formatting across tables/cards.
5. **Backend**: notifications/templates in Arabic (§5).

A string is "done" when there is **no English literal** left in JSX for that view and it renders
correctly with `dir=rtl`.

---

## 7. Conventions & gotchas

- **One source of truth for locale**: `user.language` (persisted) ↔ `locale` cookie ↔ i18next.
  Always change all three via `setLocale()` — never set `i18n.changeLanguage` alone.
- **Avoid hydration mismatch**: `dir`/`lang` must come from the cookie on the server (§2.3). Add
  `suppressHydrationWarning` on `<html>` (already used for the theme).
- **No string concatenation** for sentences — use interpolation: `t('greet', { name })` with
  `"greet": "مرحباً {{name}}"`. Arabic word order differs from English.
- **Pluralization**: i18next supports Arabic's 6 plural forms via `_zero/_one/_two/_few/_many/_other`
  keys. Use it for counts.
- **Missing keys**: in dev, set `saveMissing`/`missingKeyHandler` to log untranslated keys so you
  can catch gaps. Fallback is English.
- **Don't translate**: codes, SKUs, tag codes, enums stored in DB (translate their *labels* via a
  map, not the values).
- **Test both directions**: add a Playwright/visual check that loads a few key pages with
  `locale=ar` cookie and asserts `dir=rtl` + no overflow.

---

## 8. Quick checklist

- [ ] `src/locales/{en,ar}/*.json` created (start with `common`, `nav`)
- [ ] `src/lib/i18n.ts` initializes react-i18next with resources
- [ ] Root `layout.tsx` reads `locale` cookie → sets `<html lang dir>`
- [ ] `LocaleProvider` mounted in `providers.tsx`, follows `user.language`
- [ ] `setLocale()` helper; Settings selector switches live + persists
- [ ] Arabic font added and applied for `dir=rtl`
- [ ] Shell (sidebar/topbar/app-shell/dock) converted to logical utilities + icon flip
- [ ] `localizedName()` + `Intl` formatting helpers in use
- [ ] Per-feature string extraction underway
- [ ] `next-i18next` removed from `package.json` (Pages-Router, unused)

---

_Last updated: 2026-06-18_
