'use client';

import { create } from 'zustand';

export interface PosLine {
  variantId: string;
  menuItemId: string;
  name: string;
  variantName: string;
  priceMinor: number;
  qty: number;
  notes?: string;
}

export interface PosState {
  channel: 'DINE_IN' | 'TAKEAWAY';
  tableId: string | null;
  mealSlot: string;
  guestCount: number;
  lines: PosLine[];
  discountMinor: number;
  discountReason: string;
  setChannel: (c: 'DINE_IN' | 'TAKEAWAY') => void;
  setTable: (id: string | null) => void;
  setSlot: (s: string) => void;
  setGuests: (n: number) => void;
  setDiscount: (minor: number, reason: string) => void;
  add: (line: Omit<PosLine, 'qty'>) => void;
  bump: (variantId: string, delta: number) => void;
  setNotes: (variantId: string, notes: string) => void;
  reset: () => void;
  subtotalMinor: () => number;
  count: () => number;
}

/**
 * POS cart state, in memory only.
 *
 * Deliberately *not* persisted, unlike the customer cart: a half-built bill surviving a
 * tablet reload into the next customer's order is a billing error waiting to happen.
 * Durability for the POS lives in the IndexedDB queue of *completed* bills instead.
 */
export const usePos = create<PosState>((set, get) => ({
  channel: 'TAKEAWAY',
  tableId: null,
  mealSlot: 'LUNCH',
  guestCount: 1,
  lines: [],
  discountMinor: 0,
  discountReason: '',
  setChannel: (channel) => set({ channel, tableId: channel === 'TAKEAWAY' ? null : get().tableId }),
  setTable: (tableId) => set({ tableId }),
  setSlot: (mealSlot) => set({ mealSlot, lines: [] }),
  setGuests: (guestCount) => set({ guestCount }),
  setDiscount: (discountMinor, discountReason) => set({ discountMinor, discountReason }),
  add: (line) =>
    set((state) => {
      const existing = state.lines.find((l) => l.variantId === line.variantId);
      if (existing) {
        return {
          lines: state.lines.map((l) => (l.variantId === line.variantId ? { ...l, qty: l.qty + 1 } : l)),
        };
      }
      return { lines: [...state.lines, { ...line, qty: 1 }] };
    }),
  bump: (variantId, delta) =>
    set((state) => ({
      lines: state.lines
        .map((l) => (l.variantId === variantId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    })),
  setNotes: (variantId, notes) =>
    set((state) => ({ lines: state.lines.map((l) => (l.variantId === variantId ? { ...l, notes } : l)) })),
  reset: () => set({ lines: [], discountMinor: 0, discountReason: '', tableId: null, guestCount: 1 }),
  subtotalMinor: () => get().lines.reduce((s, l) => s + l.priceMinor * l.qty, 0),
  count: () => get().lines.reduce((s, l) => s + l.qty, 0),
}));
