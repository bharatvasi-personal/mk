'use client';

import { formatMinor } from '@mk/shared';
import { Button } from '@/components/ui';

/**
 * An on-screen numeric keypad.
 *
 * The POS does not use the OS keyboard for amounts. On a tablet it covers half the
 * screen, it puts the digits somewhere different on every device, and it is slow to hit
 * with wet or floury hands. A fixed 3x4 grid of 64px targets is faster and — more
 * importantly — is in the same place every single time, which is what lets someone stop
 * looking at it.
 */
export function Keypad({
  value,
  onChange,
  onSubmit,
  submitLabel,
  submitDisabled,
}: {
  /** Amount in paise. */
  value: number;
  onChange: (paise: number) => void;
  onSubmit?: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
}) {
  // Digits accumulate from the right, the way every till and card machine behaves:
  // typing 2-7-0 gives ₹2.70, and pressing 00 gives ₹270.00.
  const push = (digits: string) => onChange(Math.min(value * 10 ** digits.length + Number(digits), 99_99_99_99));
  const backspace = () => onChange(Math.floor(value / 10));

  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0'];

  return (
    <div>
      <div
        className="mb-2 rounded-xl border border-ink-200 bg-ink-50 px-4 py-3 text-right font-mono text-3xl tabular-nums"
        aria-live="polite"
      >
        {formatMinor(value)}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => push(k)}
            className="pos-tap h-14 rounded-xl border border-ink-200 bg-white text-xl font-semibold text-ink-900 active:scale-[0.97] active:bg-brand-100"
          >
            {k}
          </button>
        ))}
        <button
          type="button"
          onClick={backspace}
          aria-label="Backspace"
          className="pos-tap h-14 rounded-xl border border-ink-200 bg-white text-xl text-ink-600 active:scale-[0.97] active:bg-ink-100"
        >
          ⌫
        </button>
      </div>
      {onSubmit ? (
        <Button size="lg" className="mt-2 w-full" onClick={onSubmit} disabled={submitDisabled}>
          {submitLabel}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A small integer pad for line quantities — separate from the money keypad because
 * "how many thalis" and "how much cash" are different questions and sharing a control
 * for them invites the wrong answer.
 */
export function QuantityPad({
  value,
  onChange,
  max = 99,
}: {
  value: number;
  onChange: (qty: number) => void;
  max?: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(Math.min(max, value * 10 + n))}
          className="pos-tap h-14 rounded-xl border border-ink-200 bg-white text-xl font-semibold active:scale-[0.97] active:bg-brand-100"
        >
          {n}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange(0)}
        className="pos-tap h-14 rounded-xl border border-ink-200 bg-white text-sm text-ink-600 active:bg-ink-100"
      >
        C
      </button>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value * 10))}
        className="pos-tap h-14 rounded-xl border border-ink-200 bg-white text-xl font-semibold active:scale-[0.97] active:bg-brand-100"
      >
        0
      </button>
      <button
        type="button"
        onClick={() => onChange(Math.floor(value / 10))}
        aria-label="Backspace"
        className="pos-tap h-14 rounded-xl border border-ink-200 bg-white text-xl text-ink-600 active:bg-ink-100"
      >
        ⌫
      </button>
    </div>
  );
}
