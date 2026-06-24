import type { PrismaService } from '../database/prisma.service';

/**
 * Resolve the START of the shift that is active right now for a factory, from the
 * shift templates (HH:mm windows, overnight-aware). Returns null when there is no
 * factory context or no active templates. Used so a `timeframe=shift` request means
 * the REAL current shift (start → now), not "since midnight". Mirrors the logic in
 * ShiftService.getCurrentShiftStatus so every surface agrees on the shift window.
 */
export async function currentShiftStart(
  prisma: PrismaService,
  factoryId: string | null,
): Promise<Date | null> {
  if (!factoryId) return null;
  const templates = await prisma.shiftTemplate.findMany({
    where: { factoryId, isActive: true },
    orderBy: { startTime: 'asc' },
    select: { startTime: true, endTime: true, crossesMidnight: true },
  });
  if (templates.length === 0) return null;

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const parse = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
  const inWindow = (t: (typeof templates)[number]) => {
    const s = parse(t.startTime), e = parse(t.endTime);
    return t.crossesMidnight ? nowMin >= s || nowMin < e : nowMin >= s && nowMin < e;
  };

  const active = templates.find(inWindow) ?? templates[0];
  const s = parse(active.startTime), e = parse(active.endTime);
  const startDt = new Date(now);
  startDt.setHours(Math.floor(s / 60), s % 60, 0, 0);
  // Overnight shift currently in its post-midnight portion, or shift not yet started
  // today → the active occurrence began on the previous calendar day.
  if (active.crossesMidnight && nowMin < e) startDt.setDate(startDt.getDate() - 1);
  else if (nowMin < s) startDt.setDate(startDt.getDate() - 1);
  return startDt;
}
