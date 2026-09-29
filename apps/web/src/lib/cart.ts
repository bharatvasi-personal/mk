'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CartLine {
  variantId: string;
  name: string;
  variantName: string;
  priceMinor: number;
  mealSlot: string;
  branchId: string;
  qty: number;
  notes?: string;
}

interface CartState {
  lines: CartLine[];
  add: (line: Omit<CartLine, 'qty'>) => void;
  setQty: (variantId: string, qty: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
  subtotalMinor: () => number;
  count: () => number;
}

/**
 * The customer cart, persisted to localStorage.
 *
 * Persisted because the OTP step sends people to their SMS app and back, and losing the
 * cart on that round trip loses the order. The POS cart is deliberately *not* this store
 * — it is per-order state that must never survive a reload into the next customer's bill.
 */
export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      add: (line) =>
        set((state) => {
          const existing = state.lines.find((l) => l.variantId === line.variantId);
          if (existing) {
            return {
              lines: state.lines.map((l) =>
                l.variantId === line.variantId ? { ...l, qty: l.qty + 1 } : l,
              ),
            };
          }
          return { lines: [...state.lines, { ...line, qty: 1 }] };
        }),
      setQty: (variantId, qty) =>
        set((state) => ({
          lines:
            qty <= 0
              ? state.lines.filter((l) => l.variantId !== variantId)
              : state.lines.map((l) => (l.variantId === variantId ? { ...l, qty } : l)),
        })),
      remove: (variantId) => set((state) => ({ lines: state.lines.filter((l) => l.variantId !== variantId) })),
      clear: () => set({ lines: [] }),
      subtotalMinor: () => get().lines.reduce((s, l) => s + l.priceMinor * l.qty, 0),
      count: () => get().lines.reduce((s, l) => s + l.qty, 0),
    }),
    { name: 'mk.cart', version: 1 },
  ),
);
