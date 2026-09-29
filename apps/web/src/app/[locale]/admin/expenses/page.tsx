'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { formatMinor } from '@mk/shared';
import { Badge, Button, Card, Empty, ErrorNote, Table } from '@/components/ui';
import {
  CheckField,
  FormDialog,
  FormGrid,
  MoneyField,
  SelectField,
  TextField,
  Toolbar,
} from '@/components/admin/form';
import { StaffShell } from '@/components/staff-shell';
import { get, post } from '@/lib/api';
import { useSession } from '@/lib/session';

interface ExpenseCategory {
  id: string;
  name: string;
  isFixed: boolean;
}

interface ExpenseRow {
  id: string;
  amountMinor: number;
  incurredOn: string;
  paymentMethod: string | null;
  reference: string | null;
  description: string | null;
  category: { name: string; isFixed: boolean };
}

const PAYMENT_METHODS = ['CASH', 'UPI', 'NEFT', 'CARD', 'CHEQUE'];

export default function ExpensesPage() {
  return (
    <StaffShell requires="expense:read" title="Expenses">
      <Expenses />
    </StaffShell>
  );
}

/**
 * Everything the business spends that is not food and not salary.
 *
 * Rent, electricity, the gas refill, the plumber who came about the sink. Without this
 * screen a partner looking at the reports sees revenue minus food cost minus staff cost
 * and reads it as profit, which it is not — and the gap is exactly the fixed monthly
 * outgoings that decide whether 25 thalis a day is survivable.
 *
 * The isFixed flag is the one that matters: fixed costs divided by contribution per thali
 * is the break-even count, and that number is what tells the partners whether a slow
 * Tuesday was merely slow or actually loss-making.
 */
function Expenses() {
  const { branchId, can } = useSession();
  const queryClient = useQueryClient();

  const firstOfMonth = () => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
  };

  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [recording, setRecording] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);

  const categories = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => get<ExpenseCategory[]>('/expenses/categories'),
  });

  const expenses = useQuery({
    queryKey: ['expenses', branchId, from, to],
    enabled: !!branchId,
    queryFn: () => get<ExpenseRow[]>(`/expenses?${new URLSearchParams({ branchId: branchId!, from, to })}`),
  });

  const rows = expenses.data ?? [];

  const summary = useMemo(() => {
    const fixed = rows.filter((r) => r.category.isFixed).reduce((s, r) => s + r.amountMinor, 0);
    const variable = rows.filter((r) => !r.category.isFixed).reduce((s, r) => s + r.amountMinor, 0);

    const byCategory = new Map<string, number>();
    for (const r of rows) byCategory.set(r.category.name, (byCategory.get(r.category.name) ?? 0) + r.amountMinor);

    return {
      fixed,
      variable,
      total: fixed + variable,
      byCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [rows]);

  return (
    <div className="space-y-3">
      <Toolbar>
        <TextField label="From" value={from} onChange={setFrom} type="date" />
        <TextField label="To" value={to} onChange={setTo} type="date" />
        {can('expense:write') ? (
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={() => setAddingCategory(true)}>
              New category
            </Button>
            <Button onClick={() => setRecording(true)}>Record expense</Button>
          </div>
        ) : null}
      </Toolbar>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-400">Total in range</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums">{formatMinor(summary.total)}</p>
          <p className="mt-1 text-xs text-ink-600">{rows.length} entries</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-400">Fixed</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums">{formatMinor(summary.fixed)}</p>
          <p className="mt-1 text-xs text-ink-600">Rent, wifi, licences — owed whether or not you open</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-400">Variable</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums">{formatMinor(summary.variable)}</p>
          <p className="mt-1 text-xs text-ink-600">Gas, repairs, packaging — moves with how busy you are</p>
        </Card>
      </div>

      {summary.byCategory.length > 0 ? (
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-400">Where it went</p>
          <div className="mt-3 space-y-2">
            {summary.byCategory.map(([name, minor]) => (
              <div key={name} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-sm">{name}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{ width: `${summary.total ? (minor / summary.total) * 100 : 0}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-sm font-medium tabular-nums">
                  {formatMinor(minor)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <ErrorNote error={expenses.error} />

      {rows.length === 0 ? (
        <Empty>Nothing recorded in this range.</Empty>
      ) : (
        <Table head={['When', 'Category', 'What for', 'Paid by', 'Amount']}>
          {rows.map((e) => (
            <tr key={e.id}>
              <td className="px-3 py-2 tabular-nums">{e.incurredOn.slice(0, 10)}</td>
              <td className="px-3 py-2">
                {e.category.name}{' '}
                <Badge tone={e.category.isFixed ? 'warn' : 'neutral'}>
                  {e.category.isFixed ? 'fixed' : 'variable'}
                </Badge>
              </td>
              <td className="px-3 py-2">
                <div className="text-sm">{e.description ?? '—'}</div>
                {e.reference ? <div className="text-xs text-ink-400">{e.reference}</div> : null}
              </td>
              <td className="px-3 py-2 text-sm">{e.paymentMethod?.toLowerCase() ?? '—'}</td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMinor(e.amountMinor)}</td>
            </tr>
          ))}
        </Table>
      )}

      {recording ? (
        <RecordExpenseDialog
          branchId={branchId!}
          categories={categories.data ?? []}
          onClose={() => setRecording(false)}
          onDone={() => {
            setRecording(false);
            void queryClient.invalidateQueries({ queryKey: ['expenses'] });
          }}
        />
      ) : null}

      {addingCategory ? (
        <CategoryDialog
          onClose={() => setAddingCategory(false)}
          onDone={() => {
            setAddingCategory(false);
            void queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
          }}
        />
      ) : null}
    </div>
  );
}

function RecordExpenseDialog({
  branchId,
  categories,
  onClose,
  onDone,
}: {
  branchId: string;
  categories: ExpenseCategory[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [categoryId, setCategoryId] = useState('');
  const [amountMinor, setAmountMinor] = useState(0);
  const [incurredOn, setIncurredOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      post('/expenses', {
        branchId,
        categoryId,
        amountMinor,
        incurredOn,
        paymentMethod,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    onSuccess: onDone,
  });

  return (
    <FormDialog
      title="Record an expense"
      subtitle="Anything the business paid for that is not stock and not salary"
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={!categoryId || amountMinor <= 0}
      submitLabel="Record"
    >
      <FormGrid>
        <SelectField
          label="Category"
          value={categoryId}
          onChange={setCategoryId}
          required
          placeholder={categories.length ? 'Pick one…' : 'Create a category first'}
          options={categories.map((c) => ({
            value: c.id,
            label: `${c.name}${c.isFixed ? ' (fixed)' : ''}`,
          }))}
        />
        <MoneyField label="Amount" minor={amountMinor} onChange={setAmountMinor} required />
        <TextField label="Date" value={incurredOn} onChange={setIncurredOn} type="date" required />
        <SelectField
          label="Paid by"
          value={paymentMethod}
          onChange={setPaymentMethod}
          options={PAYMENT_METHODS.map((m) => ({ value: m, label: m.toLowerCase() }))}
        />
      </FormGrid>
      <TextField
        label="What for"
        value={description}
        onChange={setDescription}
        placeholder="Gas cylinder refill — two 19kg"
        hint="Written as it would be explained to the other partner six months from now"
      />
      <TextField
        label="Reference"
        value={reference}
        onChange={setReference}
        placeholder="UPI txn / bill no."
        hint="What to search for if this ever needs matching against a bank statement"
      />
    </FormDialog>
  );
}

/**
 * Categories are deliberately thin — a name and one flag.
 *
 * The temptation is a full chart of accounts. That comes later, with the ledger; a shop
 * that has not opened yet needs to know what rent and gas cost, not which of forty account
 * codes a plumber's invoice belongs under.
 */
function CategoryDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [isFixed, setIsFixed] = useState(false);

  const mutation = useMutation({
    mutationFn: () => post('/expenses/categories', { name: name.trim(), isFixed }),
    onSuccess: onDone,
  });

  return (
    <FormDialog
      title="New expense category"
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={name.trim().length < 2}
      submitLabel="Create"
    >
      <TextField label="Name" value={name} onChange={setName} required autoFocus placeholder="Shop rent" />
      <CheckField
        label="Fixed cost"
        checked={isFixed}
        onChange={setIsFixed}
        hint="Owed every month whether the shop sells one thali or two hundred. Fixed costs are what the break-even thali count is calculated from."
      />
    </FormDialog>
  );
}
