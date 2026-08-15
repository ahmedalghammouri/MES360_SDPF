'use client';

import { useTranslation } from 'react-i18next';
import { useDashboardPrefsStore } from '@/store/dashboard-prefs-store';

/**
 * The OEE calculation basis the user has selected, and the helpers for honouring
 * it consistently.
 *
 * ── The two bases ───────────────────────────────────────────────────────────
 *   • SCHEDULE-BASED (default) — Availability is measured against the PLANNED
 *     production time. Downtime that was never scheduled to be production time
 *     is not charged. This is the figure a plant commits to in a plan.
 *   • TIME-BASED (OEE-TB)      — Availability is measured against uptime +
 *     downtime, i.e. the clock the equipment actually faced. Harsher, and the
 *     one maintenance teams recognise.
 *
 * Neither is "the right one"; they answer different questions. What is NOT
 * acceptable is a screen that mixes them, or a toggle that changes one card and
 * leaves the rest alone — the user then compares two numbers computed on
 * different bases and concludes the system is wrong.
 *
 * ── Why a hook and not `atOee ? x : y` at each call site ─────────────────────
 * That inline form was already copied into a handful of views and omitted from
 * two dozen others, which is exactly how the toggle came to look inert. Reading
 * the mode through one helper means a card either honours it or visibly does not
 * import it — no silent third state.
 *
 *   const oee = useOeeMode();
 *   <KPICard title={oee.label(t('cards.oee'))} value={oee.pick(d.oee, d.oeeTb)} />
 */
export function useOeeMode() {
  const { t } = useTranslation('common');
  const { atOee, setAtOee } = useDashboardPrefsStore();

  /**
   * Choose between the schedule-based and time-based value.
   *
   * `tbValue` is optional on purpose: several endpoints do not return a
   * time-based variant yet. When it is missing we fall back to the schedule
   * figure rather than rendering 0 or a blank — but `isExact` reports that the
   * card could not honour the toggle, so a caller can mark it instead of
   * quietly showing the wrong basis.
   */
  const pick = (scheduleValue: number | null | undefined, tbValue?: number | null) => {
    if (!atOee) return scheduleValue ?? 0;
    return tbValue ?? scheduleValue ?? 0;
  };

  /** True when the displayed number really is on the selected basis. */
  const isExact = (tbValue?: number | null) => !atOee || tbValue != null;

  /** Suffix a card title so the basis is visible on the card, not only in the filter. */
  const label = (base: string) => (atOee ? `${base} (${t('atOee.tb')})` : base);

  /** Short name of the active basis, for legends and tooltips. */
  const basisName = atOee ? t('atOee.tb') : t('atOee.schedule');

  return { atOee, setAtOee, pick, isExact, label, basisName, t };
}
