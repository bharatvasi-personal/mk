'use client';

import { formatMinor } from '@mk/shared';
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-ink-200 bg-white p-4 shadow-sm ${className}`}>{children}</div>
  );
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'leaf';
  size?: 'sm' | 'md' | 'lg';
}) {
  const variants = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-300',
    secondary: 'bg-white text-ink-800 border border-ink-200 hover:bg-ink-50',
    ghost: 'text-ink-600 hover:bg-ink-100',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    leaf: 'bg-leaf-500 text-white hover:bg-leaf-600 disabled:bg-leaf-500/50',
  };
  const sizes = { sm: 'px-2.5 py-1.5 text-sm', md: 'px-4 py-2', lg: 'px-5 py-3 text-lg' };
  return (
    <button
      {...props}
      className={`pos-tap inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Money({ minor, className = '' }: { minor: number; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatMinor(minor)}</span>;
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'brand';
}) {
  const tones = {
    neutral: 'bg-ink-100 text-ink-600',
    good: 'bg-leaf-100 text-leaf-600',
    warn: 'bg-amber-100 text-amber-800',
    bad: 'bg-red-100 text-red-700',
    brand: 'bg-brand-100 text-brand-700',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'good' | 'warn' | 'bad';
}) {
  const toneClass = tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-leaf-600' : 'text-ink-900';
  return (
    <Card>
      <div className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-sm text-ink-600">{sub}</div> : null}
    </Card>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-800">{label}</span>
      {children}
      {hint && !error ? <span className="mt-1 block text-xs text-ink-400">{hint}</span> : null}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-ink-900 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100';

/**
 * A table that becomes a list of cards on a phone.
 *
 * An eight-column table with horizontal scroll is unusable on a handset, and the manager
 * is on a handset — they are standing in a 12x18 ft shop, not sitting at a desk. Below
 * `sm` the header row is hidden and each cell renders its column name beside its value,
 * driven by a `data-label` this component injects into every `<td>`.
 *
 * Injecting the label here rather than asking each page to repeat it means the label can
 * never drift from the header it belongs to, and no calling page had to change.
 */
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  const withLabels = Children.map(children, (row) => {
    if (!isValidElement(row)) return row;
    const rowProps = row.props as { children?: ReactNode };
    let cellIndex = 0;
    const cells = Children.map(rowProps.children, (cell) => {
      if (!isValidElement(cell)) return cell;
      const label = head[cellIndex] ?? '';
      cellIndex += 1;
      return cloneElement(cell as ReactElement<{ 'data-label'?: string }>, { 'data-label': label });
    });
    return cloneElement(row as ReactElement<{ children?: ReactNode }>, { children: cells });
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white">
      <table data-stacked className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">{withLabels}</tbody>
      </table>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-ink-200 p-8 text-center text-ink-400">{children}</div>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const requestId = (error as { requestId?: string }).requestId;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
      {requestId ? <span className="ml-2 font-mono text-xs opacity-70">#{requestId.slice(0, 8)}</span> : null}
    </div>
  );
}
