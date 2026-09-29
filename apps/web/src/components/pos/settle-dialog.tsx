'use client';

import { useState } from 'react';
import { formatMinor, type TenderType } from '@mk/shared';
import { Button, Card, Field, inputClass } from '@/components/ui';
import { useDict } from '@/lib/dict';
import { Keypad } from './keypad';

export interface Tender {
  tender: TenderType;
  amountMinor: number;
  tenderedMinor?: number;
  reference?: string;
}

type Mode = 'CASH' | 'UPI_MANUAL' | 'CARD' | 'SPLIT';

/**
 * Settling a bill.
 *
 * The layout is weighted by how often each path is actually taken, not by how tidy four
 * equal buttons look. Cash is most of the day at a thali counter, so cash owns the
 * screen: a keypad, the note denominations as large targets, and the change to give in
 * type you can read from arm's length. UPI, card and split are one tap away but do not
 * compete for space.
 *
 * The denomination buttons are the real speed-up — a customer hands over a ₹500 note,
 * the cashier taps ₹500, and the change is on screen before the note is in the drawer.
 */
export function SettleDialog({
  totalMinor,
  onCancel,
  onConfirm,
}: {
  totalMinor: number;
  onCancel: () => void;
  onConfirm: (tenders: Tender[]) => Promise<void>;
}) {
  const dict = useDict();
  const [mode, setMode] = useState<Mode>('CASH');
  const [tendered, setTendered] = useState(totalMinor);
  const [reference, setReference] = useState('');
  const [cashPart, setCashPart] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = Math.max(0, tendered - totalMinor);
  const short = Math.max(0, totalMinor - tendered);

  // ₹500 and ₹200 cover most single-note payments; the rest are there so the cashier
  // never has to fall back to the keypad for a common amount.
  const notes = [10000, 20000, 50000, 100000];

  async function confirm() {
    setError(null);
    let tenders: Tender[];

    if (mode === 'CASH') {
      if (tendered < totalMinor) return setError(`Short by ${formatMinor(short)}`);
      tenders = [{ tender: 'CASH', amountMinor: totalMinor, tenderedMinor: tendered }];
    } else if (mode === 'UPI_MANUAL') {
      if (!reference.trim()) return setError(`${dict.pos.utr} is required`);
      tenders = [{ tender: 'UPI_MANUAL', amountMinor: totalMinor, reference: reference.trim() }];
    } else if (mode === 'CARD') {
      tenders = [{ tender: 'CARD', amountMinor: totalMinor, reference: reference.trim() || undefined }];
    } else {
      const upiPart = totalMinor - cashPart;
      if (cashPart <= 0 || upiPart <= 0) return setError('Split both ways, or use a single tender');
      if (!reference.trim()) return setError(`${dict.pos.utr} is required for the UPI part`);
      tenders = [
        { tender: 'CASH', amountMinor: cashPart, tenderedMinor: cashPart },
        { tender: 'UPI_MANUAL', amountMinor: upiPart, reference: reference.trim() },
      ];
    }

    setBusy(true);
    try {
      await onConfirm(tenders);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not settle');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/60 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal
      aria-label={dict.pos.settle}
    >
      <Card className="max-h-[95vh] w-full max-w-md overflow-y-auto rounded-b-none sm:rounded-xl">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg font-semibold">{dict.pos.settle}</h2>
          <span className="text-3xl font-bold tabular-nums text-brand-700">{formatMinor(totalMinor)}</span>
        </div>

        {/* Cash dominates; the alternatives sit below it at lower weight. */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            onClick={() => setMode('CASH')}
            className={`pos-tap col-span-3 rounded-xl px-4 py-3 text-lg font-bold transition-colors ${
              mode === 'CASH' ? 'bg-brand-600 text-white' : 'border-2 border-ink-200 bg-white text-ink-800'
            }`}
          >
            {dict.pos.cash}
          </button>
          {(['UPI_MANUAL', 'CARD', 'SPLIT'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`pos-tap rounded-lg px-2 py-2 text-sm font-semibold transition-colors ${
                mode === m ? 'bg-ink-800 text-white' : 'border border-ink-200 bg-white text-ink-600'
              }`}
            >
              {m === 'UPI_MANUAL' ? dict.pos.upi : m === 'CARD' ? dict.pos.card : 'Split'}
            </button>
          ))}
        </div>

        {mode === 'CASH' ? (
          <div className="mt-4">
            <div className="mb-2 grid grid-cols-5 gap-1.5">
              <button
                onClick={() => setTendered(totalMinor)}
                className="pos-tap rounded-lg border-2 border-brand-400 bg-brand-50 py-2.5 text-sm font-bold text-brand-800 active:scale-[0.97]"
              >
                {dict.pos.exact}
              </button>
              {notes.map((n) => (
                <button
                  key={n}
                  onClick={() => setTendered(n)}
                  className="pos-tap rounded-lg border border-ink-200 bg-white py-2.5 text-sm font-semibold tabular-nums active:scale-[0.97] active:bg-brand-100"
                >
                  {n / 100}
                </button>
              ))}
            </div>

            <Keypad value={tendered} onChange={setTendered} />

            <div
              className={`mt-3 flex items-baseline justify-between rounded-xl px-4 py-3 ${
                short > 0 ? 'bg-red-50' : 'bg-leaf-100'
              }`}
            >
              <span className={`font-semibold ${short > 0 ? 'text-red-700' : 'text-leaf-600'}`}>
                {short > 0 ? 'Short by' : dict.pos.change}
              </span>
              <span
                className={`text-3xl font-bold tabular-nums ${short > 0 ? 'text-red-700' : 'text-leaf-600'}`}
              >
                {formatMinor(short > 0 ? short : change)}
              </span>
            </div>
          </div>
        ) : null}

        {mode === 'SPLIT' ? (
          <div className="mt-4">
            <p className="mb-2 text-sm text-ink-600">
              {dict.pos.cash} part — the rest ({formatMinor(Math.max(0, totalMinor - cashPart))}) goes on UPI.
            </p>
            <Keypad value={cashPart} onChange={setCashPart} />
          </div>
        ) : null}

        {mode === 'UPI_MANUAL' || mode === 'CARD' || mode === 'SPLIT' ? (
          <div className="mt-4">
            <Field
              label={mode === 'CARD' ? 'Auth code' : dict.pos.utr}
              hint={mode === 'CARD' ? undefined : 'Last digits from the customer’s UPI app — this is what matches the bank statement'}
            >
              <input
                className={`${inputClass} text-lg`}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                autoFocus
                inputMode="text"
              />
            </Field>
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
        ) : null}

        <div className="mt-4 grid grid-cols-[1fr_2fr] gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy} size="lg">
            {dict.common.cancel}
          </Button>
          <Button onClick={confirm} disabled={busy} size="lg" variant="leaf">
            {busy ? dict.common.saving : `${dict.pos.printBill} · ${formatMinor(totalMinor)}`}
          </Button>
        </div>
      </Card>
    </div>
  );
}
