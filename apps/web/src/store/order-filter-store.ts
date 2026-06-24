import { create } from 'zustand';

interface OrderFilterState {
  /** Selected Production Order number ('' = all POs). */
  poNumber: string;
  /** Selected Work Order id ('' = all WOs). */
  woId: string;
  setPoNumber: (v: string) => void;
  setWoId: (v: string) => void;
  reset: () => void;
}

/**
 * Global Production-Order / Work-Order filter, driven from the unified ScopePanel
 * and read by the production/manufacturing KPI + OEE pages. Session-scoped (not
 * persisted) since order lists change between visits.
 */
export const useOrderFilterStore = create<OrderFilterState>((set) => ({
  poNumber: '',
  woId: '',
  setPoNumber: (poNumber) => set({ poNumber, woId: '' }), // changing PO clears WO
  setWoId: (woId) => set({ woId }),
  reset: () => set({ poNumber: '', woId: '' }),
}));
