'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  DIET_LABELS,
  DIET_TYPES,
  MEAL_SHIFTS,
  MEAL_SHIFT_LABELS,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_PLAN_LABELS,
  formatMinor,
  type DietType,
  type MealShift,
  type SubscriptionPlan,
} from '@mk/shared';
import { Badge, Button, Card, Empty, ErrorNote, Field, Table } from '@/components/ui';
import { CheckField, FormDialog, FormGrid, FullWidth, MoneyField, SelectField, TextField, Toolbar } from '@/components/admin/form';
import { StaffShell } from '@/components/staff-shell';
import { get, post, put } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Subscription {
  id: string;
  branchId: string;
  customerName: string;
  customerPhone: string;
  addressLine: string | null;
  area: string | null;
  plan: SubscriptionPlan;
  diet: DietType;
  shift: MealShift;
  daysOfWeek: number[];
  startDate: string;
  endDate: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'COMPLETED';
  pausedFrom: string | null;
  pausedTo: string | null;
  amountMinor: number;
  isPaid: boolean;
  notes: string | null;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function SubscriptionsPage() {
  return (
    <StaffShell requires="subscription:read" title="Subscriptions">
      <Subscriptions />
    </StaffShell>
  );
}

/**
 * Weekly and monthly meal plans.
 *
 * The website sells these; this is where one is recorded and run. The table is the book of
 * standing plans; the panel below turns them into today's delivery list. Recurring online
 * payment is not wired yet — collection is however the shop already does it, and the paid
 * flag is how the partners keep track.
 */
function Subscriptions() {
  const { branchId, can } = useSession();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Subscription | 'NEW' | null>(null);
  const [pausing, setPausing] = useState<Subscription | null>(null);

  const query = useQuery({
    queryKey: ['subscriptions', branchId, status],
    enabled: !!branchId,
    queryFn: () =>
      get<Subscription[]>(`/subscriptions?${new URLSearchParams({ branchId: branchId!, ...(status ? { status } : {}) })}`),
  });

  const rows = query.data ?? [];
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['subscriptions'] });

  const status$ = useMutation({
    mutationFn: (v: { id: string; status: string }) => post(`/subscriptions/${v.id}/status`, { status: v.status }),
    onSuccess: refresh,
  });
  const paid$ = useMutation({
    mutationFn: (v: { id: string; isPaid: boolean }) => post(`/subscriptions/${v.id}/paid`, { isPaid: v.isPaid }),
    onSuccess: refresh,
  });

  return (
    <div className="space-y-4">
      <Toolbar>
        <SelectField
          label="Status"
          value={status}
          onChange={setStatus}
          placeholder="All"
          options={['ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED'].map((s) => ({ value: s, label: s.toLowerCase() }))}
        />
        {can('subscription:write') ? (
          <div className="ml-auto">
            <Button onClick={() => setEditing('NEW')}>New subscription</Button>
          </div>
        ) : null}
      </Toolbar>

      <ErrorNote error={query.error ?? status$.error ?? paid$.error} />

      {rows.length === 0 ? (
        <Empty>No subscriptions yet. The website advertises weekly and monthly plans — add the first one here.</Empty>
      ) : (
        <Table
          head={[
            'Customer',
            'Plan',
            'Days',
            'Period',
            'Amount',
            'Paid',
            'Status',
            ...(can('subscription:write') ? [''] : []),
          ]}
        >
          {rows.map((s) => (
            <tr key={s.id} className={s.status === 'CANCELLED' || s.status === 'COMPLETED' ? 'opacity-50' : undefined}>
              <td className="px-3 py-2">
                <div className="font-medium">{s.customerName}</div>
                <div className="text-xs text-ink-400">
                  {s.customerPhone}
                  {s.area ? ` · ${s.area}` : ''}
                </div>
              </td>
              <td className="px-3 py-2 text-sm">
                <div>{SUBSCRIPTION_PLAN_LABELS[s.plan]}</div>
                <div className="text-xs text-ink-400">
                  {MEAL_SHIFT_LABELS[s.shift]} · {DIET_LABELS[s.diet]}
                </div>
              </td>
              <td className="px-3 py-2 text-xs tabular-nums">
                {s.daysOfWeek.length === 7 ? 'Every day' : s.daysOfWeek.map((d) => DAY_NAMES[d]).join(' ')}
              </td>
              <td className="px-3 py-2 text-xs tabular-nums">
                {s.startDate.slice(0, 10)}
                {s.endDate ? ` → ${s.endDate.slice(0, 10)}` : ''}
                {s.status === 'PAUSED' && s.pausedFrom ? (
                  <div className="text-amber-700">paused {s.pausedFrom.slice(0, 10)}–{s.pausedTo?.slice(0, 10)}</div>
                ) : null}
              </td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMinor(s.amountMinor)}</td>
              <td className="px-3 py-2">
                {can('subscription:write') ? (
                  <button
                    type="button"
                    onClick={() => paid$.mutate({ id: s.id, isPaid: !s.isPaid })}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      s.isPaid ? 'bg-leaf-100 text-leaf-600' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {s.isPaid ? 'paid' : 'mark paid'}
                  </button>
                ) : (
                  <Badge tone={s.isPaid ? 'good' : 'warn'}>{s.isPaid ? 'paid' : 'unpaid'}</Badge>
                )}
              </td>
              <td className="px-3 py-2">
                <Badge
                  tone={
                    s.status === 'ACTIVE' ? 'good' : s.status === 'PAUSED' ? 'warn' : 'neutral'
                  }
                >
                  {s.status.toLowerCase()}
                </Badge>
              </td>
              {can('subscription:write') ? (
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                      Edit
                    </Button>
                    {s.status === 'ACTIVE' ? (
                      <Button size="sm" variant="secondary" onClick={() => setPausing(s)}>
                        Pause
                      </Button>
                    ) : null}
                    {s.status === 'PAUSED' ? (
                      <Button size="sm" variant="secondary" onClick={() => status$.mutate({ id: s.id, status: 'ACTIVE' })}>
                        Resume
                      </Button>
                    ) : null}
                    {s.status === 'ACTIVE' || s.status === 'PAUSED' ? (
                      <Button size="sm" variant="ghost" onClick={() => status$.mutate({ id: s.id, status: 'CANCELLED' })}>
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      )}

      <DueTodayPanel />

      {editing ? (
        <SubscriptionDialog
          subscription={editing === 'NEW' ? null : editing}
          branchId={branchId!}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      ) : null}

      {pausing ? (
        <PauseDialog
          subscription={pausing}
          onClose={() => setPausing(null)}
          onDone={() => {
            setPausing(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

interface DueList {
  date: string;
  total: number;
  veg: number;
  nonVeg: number;
  mixed: number;
  mealCount: number;
  rows: {
    id: string;
    customerName: string;
    customerPhone: string;
    addressLine: string | null;
    area: string | null;
    diet: DietType;
    shift: MealShift;
    isPaid: boolean;
  }[];
}

/**
 * Today's delivery list.
 *
 * The one query the kitchen actually runs each morning: who gets a box today, how many veg
 * and how many non-veg, before anyone reads a name. Day-of-week, pauses and one-off skips
 * are already applied by the API.
 */
function DueTodayPanel() {
  const { branchId } = useSession();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [shift, setShift] = useState('BOTH');

  const query = useQuery({
    queryKey: ['subscriptions-due', branchId, date, shift],
    enabled: !!branchId,
    queryFn: () => get<DueList>(`/subscriptions/due/${branchId}?date=${date}&shift=${shift}`),
  });
  const data = query.data;

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="font-display font-semibold">Delivery list</h2>
        <Field label="Date">
          <input
            className="h-10 rounded-lg border border-ink-200 px-3 text-sm"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <div className="w-40">
          <SelectField
            label="Shift"
            value={shift}
            onChange={setShift}
            options={MEAL_SHIFTS.map((s) => ({ value: s, label: MEAL_SHIFT_LABELS[s] }))}
          />
        </div>
      </div>

      {data ? (
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Badge tone="brand">{data.total} deliveries</Badge>
          <Badge tone="neutral">{data.mealCount} meals</Badge>
          <Badge tone="good">{data.veg} veg</Badge>
          <Badge tone="warn">{data.nonVeg} non-veg</Badge>
          {data.mixed ? <Badge tone="neutral">{data.mixed} mixed</Badge> : null}
        </div>
      ) : null}

      <ErrorNote error={query.error} />

      {data && data.rows.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <Table head={['Customer', 'Diet', 'Shift', 'Where', 'Paid']}>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  <div className="font-medium">{r.customerName}</div>
                  <div className="text-xs text-ink-400">{r.customerPhone}</div>
                </td>
                <td className="px-3 py-2 text-sm">{DIET_LABELS[r.diet]}</td>
                <td className="px-3 py-2 text-sm">{MEAL_SHIFT_LABELS[r.shift]}</td>
                <td className="px-3 py-2 text-sm">{[r.addressLine, r.area].filter(Boolean).join(', ') || '—'}</td>
                <td className="px-3 py-2">
                  <Badge tone={r.isPaid ? 'good' : 'warn'}>{r.isPaid ? 'paid' : 'unpaid'}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      ) : data ? (
        <p className="mt-3 text-sm text-ink-400">Nothing due for this date and shift.</p>
      ) : null}
    </Card>
  );
}

function SubscriptionDialog({
  subscription,
  branchId,
  onClose,
  onDone,
}: {
  subscription: Subscription | null;
  branchId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    customerName: subscription?.customerName ?? '',
    customerPhone: subscription?.customerPhone ?? '',
    addressLine: subscription?.addressLine ?? '',
    area: subscription?.area ?? '',
    plan: subscription?.plan ?? 'MONTHLY',
    diet: subscription?.diet ?? 'VEG',
    shift: subscription?.shift ?? 'LUNCH',
    startDate: subscription?.startDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    endDate: subscription?.endDate?.slice(0, 10) ?? '',
    amountMinor: subscription?.amountMinor ?? 0,
    notes: subscription?.notes ?? '',
  });
  const [days, setDays] = useState<number[]>(subscription?.daysOfWeek ?? [1, 2, 3, 4, 5, 6]);
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        branchId: subscription?.branchId ?? branchId,
        customerName: f.customerName.trim(),
        customerPhone: f.customerPhone.trim(),
        plan: f.plan,
        diet: f.diet,
        shift: f.shift,
        daysOfWeek: days,
        startDate: f.startDate,
        amountMinor: f.amountMinor,
        ...(f.endDate ? { endDate: f.endDate } : {}),
        ...(f.addressLine.trim() ? { addressLine: f.addressLine.trim() } : {}),
        ...(f.area.trim() ? { area: f.area.trim() } : {}),
        ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
      };
      return subscription ? put(`/subscriptions/${subscription.id}`, body) : post('/subscriptions', body);
    },
    onSuccess: onDone,
  });

  const phoneValid = /^(\+91)?[6-9]\d{9}$/.test(f.customerPhone.trim());
  const invalid = f.customerName.trim().length < 2 || !phoneValid || days.length === 0 || f.amountMinor <= 0;

  return (
    <FormDialog
      title={subscription ? `Edit ${subscription.customerName}` : 'New subscription'}
      subtitle="Recurring online payment comes later — record the agreed price and collect as usual"
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={invalid}
      submitLabel={subscription ? 'Save' : 'Create'}
      wide
    >
      <FormGrid>
        <TextField label="Customer name" value={f.customerName} onChange={set('customerName')} required autoFocus />
        <TextField label="Phone" value={f.customerPhone} onChange={set('customerPhone')} required placeholder="98765 43210" />
        <SelectField
          label="Plan"
          value={f.plan}
          onChange={(v) => set('plan')(v as SubscriptionPlan)}
          options={SUBSCRIPTION_PLANS.map((p) => ({ value: p, label: SUBSCRIPTION_PLAN_LABELS[p] }))}
        />
        <SelectField
          label="Meals"
          value={f.shift}
          onChange={(v) => set('shift')(v as MealShift)}
          options={MEAL_SHIFTS.map((s) => ({ value: s, label: MEAL_SHIFT_LABELS[s] }))}
        />
        <SelectField
          label="Diet"
          value={f.diet}
          onChange={(v) => set('diet')(v as DietType)}
          options={DIET_TYPES.map((d) => ({ value: d, label: DIET_LABELS[d] }))}
        />
        <MoneyField label="Agreed price" minor={f.amountMinor} onChange={set('amountMinor')} required hint="For the whole plan period" />
        <TextField label="Start date" value={f.startDate} onChange={set('startDate')} type="date" required />
        <TextField label="End date" value={f.endDate} onChange={set('endDate')} type="date" hint="Blank for open-ended" />
      </FormGrid>

      <Field label="Delivery days" hint="Most plans run Monday to Saturday">
        <div className="flex flex-wrap gap-1.5">
          {DAY_NAMES.map((d, i) => {
            const on = days.includes(i);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => setDays((prev) => (on ? prev.filter((x) => x !== i) : [...prev, i].sort()))}
                className={`pos-tap rounded-lg border px-3 py-2 text-sm font-semibold ${
                  on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-600'
                }`}
              >
                {d}
              </button>
            );
          })}
        </div>
      </Field>

      <FormGrid>
        <TextField label="Area / zone" value={f.area} onChange={set('area')} placeholder="Gachibowli" />
        <TextField label="Address" value={f.addressLine} onChange={set('addressLine')} />
      </FormGrid>
      <FullWidth>
        <TextField label="Notes" value={f.notes} onChange={set('notes')} placeholder="No garlic; leave at gate" />
      </FullWidth>
    </FormDialog>
  );
}

function PauseDialog({
  subscription,
  onClose,
  onDone,
}: {
  subscription: Subscription;
  onClose: () => void;
  onDone: () => void;
}) {
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState('');

  const mutation = useMutation({
    mutationFn: () => post(`/subscriptions/${subscription.id}/status`, { status: 'PAUSED', pausedFrom: from, pausedTo: to }),
    onSuccess: onDone,
  });

  return (
    <FormDialog
      title={`Pause ${subscription.customerName}`}
      subtitle="Deliveries stop between these dates and resume automatically after"
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={!from || !to || to < from}
      submitLabel="Pause"
    >
      <FormGrid>
        <TextField label="Paused from" value={from} onChange={setFrom} type="date" required />
        <TextField label="Paused until" value={to} onChange={setTo} type="date" required />
      </FormGrid>
    </FormDialog>
  );
}
