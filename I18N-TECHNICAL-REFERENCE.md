# i18n Technical Reference (Arabic / English) — **MANDATORY for all new web work**

This is the authoritative, day-to-day reference for internationalization in `apps/web`.
Every new feature **must** follow it. For the higher-level rationale see
`I18N-ARABIC-ENGLISH-GUIDE.md`; this file is the "how to actually code it".

> **Rule of thumb:** no English string literal may ship in JSX, and no physical
> direction utility (`pl-/pr-/ml-/mr-/left-/right-/text-left/right`) may ship in new code.

---

## 1. What's already wired (don't rebuild it)

| Piece | File |
|-------|------|
| i18next instance + namespaces | `src/lib/i18n.ts` |
| `setLocale()` + `useLocale()` | `src/lib/use-locale.ts` |
| Provider (follows `user.language`) | `src/components/locale-provider.tsx` (mounted in `components/providers.tsx`) |
| Server `<html lang/dir>` from cookie + Arabic font | `src/app/layout.tsx` |
| RTL font rule | `src/app/globals.css` (`[dir="rtl"]`), `tailwind.config.ts` (`--font-arabic`) |
| Language switcher (topbar globe) | `src/components/layout/topbar.tsx` → `LanguageSwitcher` |
| Translated + RTL: sidebar, app-shell offset, apps launcher, settings shell | see those files |
| Dictionaries | `src/locales/{en,ar}/{common,shell,settings,apps,nav}.json` |

**Locale flow (single source of truth):** `user.language` (DB) ⇄ `locale` cookie ⇄ i18next.
`setLocale()` updates all three + `<html lang/dir>`. The `LocaleProvider` re-applies whenever
`user.language` changes (login, profile update). **Never call `i18n.changeLanguage()` directly.**

---

## 2. Translating a new feature — the recipe

1. **Add a namespace** = one JSON file per domain, in both locales:
   `src/locales/en/<feature>.json` and `src/locales/ar/<feature>.json`.
2. **Register it** in `src/lib/i18n.ts`: import both, add to `resources.en`/`resources.ar`,
   and add the name to the `NAMESPACES` array.
3. **Use it** in the component:
   ```tsx
   'use client';
   import { useTranslation } from 'react-i18next';
   export function Foo() {
     const { t } = useTranslation('feature');   // your namespace
     return <h1>{t('title')}</h1>;               // common is always available too
   }
   ```
4. **Replace every literal** with `t('key')`. Use `common:` for shared words:
   `const { t } = useTranslation(['feature', 'common']);` → `t('common:actions.save')`.
5. **Fix RTL** in the same pass (see §4). A view is "done" only when both are done.

### Key naming
- `namespace:section.item`, lowercase, dot-nested, **stable** (never the English sentence as the key — except the `nav` namespace, see §3).
- Interpolation, never concatenation: `t('greet', { name })` with `"greet": "مرحباً {{name}}"`.
- Counts use i18next plurals: `key_zero/_one/_two/_few/_many/_other` (Arabic has 6 forms).

---

## 3. The `nav` namespace (special: flat English-label keys)

The sidebar/launcher have ~70 labels. To avoid threading a key through every item, the
`nav` namespace uses **the literal English label as the key**. Because labels contain `.`
and `&`, you MUST disable the separators per call and fall back to English:

```tsx
const { t } = useTranslation('nav');
const tn = (label: string) => t(label, { keySeparator: false, nsSeparator: false, defaultValue: label });
tn('Preventive Maint.')  // → "الصيانة الوقائية"
```
`en/nav` is intentionally empty (`{}`) — English is the key, so the `defaultValue` serves it.
Only `ar/nav.json` holds translations. **Use this pattern only for menu/label catalogues**, not
for normal UI copy.

---

## 4. RTL — logical utilities (REQUIRED in new code)

Setting `<html dir="rtl">` flips text and flex order automatically, but **physical** spacing
does not flip. Always use logical Tailwind utilities so one class works in both directions:

| ❌ Physical (don't use) | ✅ Logical (use) |
|------------------------|------------------|
| `pl-4` / `pr-4` | `ps-4` / `pe-4` |
| `ml-2` / `mr-2` | `ms-2` / `me-2` |
| `left-0` / `right-0` | `start-0` / `end-0` |
| `text-left` / `text-right` | `text-start` / `text-end` |
| `border-l` / `border-r` | `border-s` / `border-e` |
| `rounded-l-*` / `rounded-r-*` | `rounded-s-*` / `rounded-e-*` |
| `-left-1` / `-right-1` | `-start-1` / `-end-1` |
| inline `style={{ marginLeft }}` | `style={{ marginInlineStart }}` |

Tailwind 3.4 (this repo) supports all of the above natively.

### Things that DON'T auto-flip — handle manually
- **Directional icons** (`ChevronLeft/Right`, arrows): flip by direction. Get it from i18next:
  ```tsx
  const { i18n } = useTranslation();
  const isRtl = i18n.dir() === 'rtl';            // or useLocale().isRtl
  {isRtl ? <ChevronLeft/> : <ChevronRight/>}
  ```
- **Radix `side` props** (Tooltip/Dropdown/Popover `side="right"`): `side={isRtl ? 'left' : 'right'}`.
- **Charts** (Recharts): reverse the X axis / legend alignment per `dir`.
- **Framer-motion x-offsets** that mean "from the side": negate for RTL.
- **Absolutely-positioned** drawers, the dock, badges: audit `start/end`.

---

## 5. Dynamic data, numbers, dates

### Bilingual DB fields (`name` / `nameAr`)
```ts
// prefer a shared helper (add to src/lib/ if not present)
const display = locale === 'ar' ? (e.nameAr || e.name) : (e.name || e.nameAr);
```
For master-data you want translated that has no `nameAr` column yet, add the column in
`apps/api/prisma/schema.prisma` + a migration and expose it in the DTO.

### Numbers / dates / currency — `Intl`, never hardcoded
```ts
const { locale } = useLocale();
new Intl.NumberFormat(locale).format(n);
new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
```
If using `date-fns`, pass the `ar` locale. (The Settings Date/Number-format prefs can feed this.)

---

## 6. Do / Don't

**Do**
- `'use client'` on any component calling `useTranslation` (it's a hook).
- Keep keys in `common` for anything reused (`actions.*`, `status.*`).
- Add the Arabic value at the same time you add the English one — never leave `ar` empty.
- Run `npx tsc --noEmit` in `apps/web` before pushing.

**Don't**
- Don't hardcode English in JSX, `placeholder`, `title`, `aria-label`, toast text.
- Don't use physical direction utilities in new code.
- Don't call `i18n.changeLanguage()` directly — use `setLocale()`.
- Don't translate codes/SKUs/tag-codes/enum **values** (translate their display labels via a map).
- Don't put a sentence as a key (except `nav`).

---

## 7. Server vs client notes
- Locale for SSR comes from the `locale` **cookie** (read in `app/layout.tsx`). `<html>` carries
  `suppressHydrationWarning` so theme + dir don't trip hydration.
- i18next runs client-side (`react: { useSuspense: false }`). Server Components can't call
  `useTranslation`; keep translated UI in client components (the app is overwhelmingly client).

---

## 8. PR checklist (paste into the PR description)

- [ ] New/changed strings live in `src/locales/{en,ar}/<ns>.json` (both locales filled)
- [ ] Namespace registered in `src/lib/i18n.ts` (if new)
- [ ] No English literal left in JSX / placeholders / titles / toasts
- [ ] No physical direction utilities; logical ones used throughout
- [ ] Directional icons + Radix `side` flip on `isRtl`
- [ ] Numbers/dates via `Intl` with the active locale
- [ ] `name`/`nameAr` rendered by locale where applicable
- [ ] Verified visually with the `locale=ar` cookie (`dir=rtl`, no overflow/clipping)
- [ ] `npx tsc --noEmit` passes in `apps/web`

---

## 9. Migration status & next surfaces

**Done:** foundation, language switcher, RTL `<html>`, sidebar, app-shell, apps launcher,
settings shell + language/appearance tabs, `common/shell/settings/apps/nav` namespaces.

**Next (one feature module per PR, by usage):** Production → Quality → Maintenance → Inventory →
IoT → Reports. For each: add a namespace, extract strings, swap to `t()`, convert to logical
utilities, flip icons/charts. Track remaining English with i18next's `saveMissing`/missing-key
logging in dev.

---

_Last updated: 2026-06-18_
