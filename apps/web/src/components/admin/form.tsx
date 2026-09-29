'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Button, Card, ErrorNote, Field, inputClass } from '@/components/ui';
import { useDict } from '@/lib/dict';

/**
 * The shared shell for every back-office editor.
 *
 * One dialog, one set of behaviours: Escape closes, a click on the backdrop closes, the
 * primary action is on the right, and it becomes a full-height sheet on a phone. The
 * alternative — each screen rolling its own — is how a back office ends up with six
 * subtly different Save buttons and one of them not confirming before it destroys
 * something.
 */
export function FormDialog({
  title,
  subtitle,
  onClose,
  onSubmit,
  submitLabel,
  submitDisabled,
  busy,
  error,
  danger,
  wide,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
  busy?: boolean;
  error?: unknown;
  danger?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const dict = useDict();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-ink-900/60 sm:items-start sm:p-6"
      role="dialog"
      aria-modal
      aria-label={title}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <Card
        className={`my-0 w-full rounded-b-none sm:my-4 sm:rounded-xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
      >
        <div className="mb-4">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-sm text-ink-600">{subtitle}</p> : null}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <div className="space-y-3">{children}</div>

          <ErrorNote error={error} />

          <div className="mt-5 flex items-center gap-2">
            {danger}
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
                {dict.common.cancel}
              </Button>
              <Button type="submit" disabled={busy || submitDisabled}>
                {busy ? dict.common.saving : (submitLabel ?? dict.common.save)}
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}

/** Two columns on anything wider than a phone; one column on a phone. */
export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

export function FullWidth({ children }: { children: ReactNode }) {
  return <div className="sm:col-span-2">{children}</div>;
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  error,
  type = 'text',
  placeholder,
  required,
  disabled,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <Field label={label + (required ? ' *' : '')} hint={hint} error={error}>
      <input
        className={inputClass}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/**
 * Money in, money out — always rupees on screen, always integer paise in state.
 *
 * The conversion happens here so no screen ever holds a float amount, which is the one
 * place rounding error could enter a system that is otherwise exact end to end.
 */
export function MoneyField({
  label,
  minor,
  onChange,
  hint,
  required,
}: {
  label: string;
  minor: number;
  onChange: (minor: number) => void;
  hint?: string;
  required?: boolean;
}) {
  const [text, setText] = useState(minor ? String(minor / 100) : '');
  useEffect(() => {
    // Keep in step when the parent resets the form, but do not fight the user mid-typing.
    const asMinor = Math.round(Number(text || 0) * 100);
    if (asMinor !== minor) setText(minor ? String(minor / 100) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minor]);

  return (
    <Field label={`${label} (₹)${required ? ' *' : ''}`} hint={hint}>
      <input
        className={`${inputClass} text-right tabular-nums`}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d.]/g, '');
          setText(raw);
          onChange(Math.round(Number(raw || 0) * 100));
        }}
      />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  hint,
  min,
  max,
  step,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  min?: number;
  max?: number;
  step?: string;
  suffix?: string;
}) {
  return (
    <Field label={suffix ? `${label} (${suffix})` : label} hint={hint}>
      <input
        className={`${inputClass} text-right tabular-nums`}
        type="number"
        min={min}
        max={max}
        step={step ?? 'any'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  hint,
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <Field label={label + (required ? ' *' : '')} hint={hint}>
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-ink-200 px-3 py-2">
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium text-ink-800">{label}</span>
        {hint ? <span className="block text-xs text-ink-400">{hint}</span> : null}
      </span>
    </label>
  );
}

/**
 * Destructive actions confirm in place rather than opening a second dialog on top of the
 * first. Two stacked modals is where people stop reading.
 */
export function DangerAction({
  label,
  confirmLabel,
  question,
  onConfirm,
  busy,
}: {
  label: string;
  confirmLabel: string;
  question: string;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const dict = useDict();
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <Button type="button" variant="ghost" className="!text-red-600" onClick={() => setArmed(true)}>
        {label}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-2 py-1.5">
      <span className="text-sm text-red-700">{question}</span>
      <Button type="button" variant="danger" size="sm" disabled={busy} onClick={onConfirm}>
        {confirmLabel}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)}>
        {dict.common.cancel}
      </Button>
    </div>
  );
}

/** A labelled section inside a long form. */
export function FormSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-ink-100 p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-400">{title}</legend>
      {hint ? <p className="mb-2 text-xs text-ink-400">{hint}</p> : null}
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`pos-tap rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            value === o.value ? 'bg-brand-600 text-white' : 'border border-ink-200 bg-white text-ink-600'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
