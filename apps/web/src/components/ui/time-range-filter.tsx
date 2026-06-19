'use client';

/**
 * TimeRangeFilter — the shared smart time filter for OEE / KPI / trend pages.
 * Today / Shift / Week / Month presets + a Custom date range. Backed by the global
 * time-range store so the selection follows the user across analysis pages.
 */

import React, { useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { CalendarRange } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTimeRangeStore, type TimePreset } from '@/store/time-range-store';

const PRESETS: { value: Exclude<TimePreset, 'custom'>; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'shift', label: 'Shift' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

export function TimeRangeFilter({ className }: { className?: string }) {
  const { preset, from, to, setPreset, setCustom } = useTimeRangeStore();
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from ?? new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10));
  const [draftTo, setDraftTo] = useState(to ?? new Date().toISOString().slice(0, 10));

  return (
    <div className={cn('inline-flex items-center rounded-lg border border-border overflow-hidden', className)}>
      {PRESETS.map((p) => (
        <button
          key={p.value}
          onClick={() => setPreset(p.value)}
          className={cn(
            'px-2.5 py-1.5 text-xs transition-colors',
            preset === p.value ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/50',
          )}
        >
          {p.label}
        </button>
      ))}
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild>
          <button
            className={cn(
              'px-2.5 py-1.5 text-xs border-l border-border flex items-center gap-1.5 transition-colors',
              preset === 'custom' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/50',
            )}
          >
            <CalendarRange size={12} />
            {preset === 'custom' && from && to ? `${from.slice(5)} – ${to.slice(5)}` : 'Custom'}
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="end"
            sideOffset={6}
            className="z-50 w-64 rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl"
          >
            <div className="space-y-2.5">
              <div>
                <label className="text-[10px] uppercase text-muted-foreground">From</label>
                <input type="date" value={draftFrom} max={draftTo} onChange={(e) => setDraftFrom(e.target.value)}
                  className="w-full h-8 px-2 text-sm rounded-md border border-input bg-background outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted-foreground">To</label>
                <input type="date" value={draftTo} min={draftFrom} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDraftTo(e.target.value)}
                  className="w-full h-8 px-2 text-sm rounded-md border border-input bg-background outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <Button size="sm" className="w-full h-8" onClick={() => { setCustom(draftFrom, draftTo); setOpen(false); }}>
                Apply range
              </Button>
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  );
}
