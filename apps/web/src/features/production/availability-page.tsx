'use client';
/**
 * Availability lives on the Equipment page now.
 *
 * ── Why this file still exists ──────────────────────────────────────────────
 * The two routes rendered the same live view and differed only in their
 * analytical half, so they became one page with the analytical halves as
 * sub-tabs. Deleting this route would have broken every bookmark and every link
 * already written into a report; rendering the merged page keeps them working
 * and lands the reader on the same content they were looking for.
 *
 * The sidebar carries ONE entry — two links to identical content is the
 * duplication this merge exists to remove.
 */
import React from 'react';

import { MachineStatusPage } from '@/features/manufacturing/machine-status-page';

export function AvailabilityPage() {
  return <MachineStatusPage />;
}
