'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formatMinor } from '@mk/shared';
import { Badge, Button, Card, Empty, ErrorNote, Field, Table, inputClass } from '@/components/ui';
import { StaffShell } from '@/components/staff-shell';
import { get, post } from '@/lib/api';
import { useDict } from '@/lib/dict';
import { useSession } from '@/lib/session';

interface Employee {
  id: string;
  employeeCode: string;
  name: string;
  phone: string | null;
  roleType: string;
  employmentType: string;
  joinedOn: string;
  isActive: boolean;
  weeklyOffDay: number | null;
  salaryStructures: {
    id: string;
    basis: string;
    monthlyGrossMinor: number | null;
    dailyRateMinor: number | null;
    payDayOfMonth: number;
  }[];
  credentials: { id: string; type: string; identifier: string }[];
  _count: { advances: number };
}

interface PayrollRun {
  id: string;
  period: string;
  status: string;
  payDate: string;
  grossMinor: number;
  deductionsMinor: number;
  netMinor: number;
  lines?: {
    id: string;
    employeeId: string;
    presentDays: string;
    absentDays: string;
    overtimeMinutes: number;
    basicMinor: number;
    overtimeMinor: number;
    advanceDeductionMinor: number;
    netMinor: number;
    employee: { name: string; employeeCode: string; roleType: string };
  }[];
}

export default function StaffPage() {
  return (
    <StaffShell requires="employee:read" title="Staff">
      <Staff />
    </StaffShell>
  );
}

function Staff() {
  const dict = useDict();
  const { can } = useSession();
  const [tab, setTab] = useState<'PEOPLE' | 'PAYROLL'>('PEOPLE');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['PEOPLE', dict.admin.staff],
            ['PAYROLL', dict.admin.payroll],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`pos-tap rounded-lg px-4 py-2 text-sm font-semibold ${
              tab === key ? 'bg-brand-600 text-white' : 'border border-ink-200 bg-white text-ink-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'PEOPLE' ? <People /> : null}
      {tab === 'PAYROLL' ? (can('payroll:read') ? <Payroll /> : <Empty>{dict.auth.noAccess}</Empty>) : null}
    </div>
  );
}

function People() {
  const dict = useDict();
  const { branchId, can } = useSession();
  const queryClient = useQueryClient();
  const [advanceFor, setAdvanceFor] = useState<Employee | null>(null);

  const query = useQuery({
    queryKey: ['employees', branchId],
    enabled: !!branchId,
    queryFn: () => get<Employee[]>(`/staff/employees?branchId=${branchId}`),
  });

  const showSalary = can('salary:read');

  return (
    <div className="space-y-3">
      <ErrorNote error={query.error} />
      <Table
        head={[
          dict.common.name,
          'Role',
          dict.common.phone,
          ...(showSalary ? ['Salary'] : []),
          'Joined',
          'Card / PIN',
          ...(can('salary:write') ? [dict.common.actions] : []),
        ]}
      >
        {(query.data ?? []).map((e) => {
          const salary = e.salaryStructures[0];
          return (
            <tr key={e.id}>
              <td className="px-3 py-2">
                <div className="font-medium">{e.name}</div>
                <div className="text-xs text-ink-400">{e.employeeCode}</div>
              </td>
              <td className="px-3 py-2">
                <div>{e.roleType.replace('_', ' ').toLowerCase()}</div>
                <div className="text-xs text-ink-400">{e.employmentType.replace('_', ' ').toLowerCase()}</div>
              </td>
              <td className="px-3 py-2">
                {e.phone ? (
                  <a className="text-brand-700 underline" href={`tel:${e.phone}`}>
                    {e.phone}
                  </a>
                ) : (
                  '—'
                )}
              </td>
              {showSalary ? (
                <td className="px-3 py-2 tabular-nums">
                  {salary?.basis === 'DAILY'
                    ? `${formatMinor(salary.dailyRateMinor ?? 0)}/day`
                    : salary?.monthlyGrossMinor
                      ? `${formatMinor(salary.monthlyGrossMinor)}/mo`
                      : '—'}
                  {e._count.advances > 0 ? (
                    <div className="mt-0.5">
                      <Badge tone="warn">{e._count.advances} advance</Badge>
                    </div>
                  ) : null}
                </td>
              ) : null}
              <td className="px-3 py-2 tabular-nums">{e.joinedOn.slice(0, 10)}</td>
              <td className="px-3 py-2">
                {e.credentials.length === 0 ? (
                  <span className="text-ink-400">—</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {e.credentials.map((c) => (
                      <Badge key={c.id} tone="neutral">
                        {c.type === 'PIN' ? 'PIN' : c.type.replace('_', ' ')}
                      </Badge>
                    ))}
                  </div>
                )}
              </td>
              {can('salary:write') ? (
                <td className="px-3 py-2">
                  <Button size="sm" variant="secondary" onClick={() => setAdvanceFor(e)}>
                    Advance
                  </Button>
                </td>
              ) : null}
            </tr>
          );
        })}
      </Table>

      {advanceFor ? (
        <AdvanceDialog
          employee={advanceFor}
          onClose={() => setAdvanceFor(null)}
          onDone={() => {
            setAdvanceFor(null);
            void queryClient.invalidateQueries({ queryKey: ['employees', branchId] });
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Salary advances.
 *
 * Universal at this wage level and always given in cash against a promise. Recording them
 * here is what lets the payroll run deduct them automatically instead of relying on
 * someone's memory — which is where wage disputes come from.
 */
function AdvanceDialog({ employee, onClose, onDone }: { employee: Employee; onClose: () => void; onDone: () => void }) {
  const dict = useDict();
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () => post('/staff/advances', { employeeId: employee.id, amountMinor: amount, reason: reason || undefined }),
    onSuccess: onDone,
  });

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink-900/50 p-4">
      <Card className="w-full max-w-sm">
        <h2 className="font-display text-lg font-semibold">{employee.name}</h2>
        <p className="text-sm text-ink-400">
          Recovered automatically from the next payroll, capped at half of net pay.
        </p>
        <div className="mt-4 space-y-3">
          <Field label={dict.common.amount}>
            <input
              className={`${inputClass} text-right`}
              type="number"
              value={amount / 100}
              onChange={(e) => setAmount(Math.round(Number(e.target.value) * 100))}
              autoFocus
            />
          </Field>
          <Field label="Reason">
            <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorNote error={mutation.error} />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={onClose}>
              {dict.common.cancel}
            </Button>
            <Button disabled={amount <= 0 || mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? dict.common.saving : dict.common.save}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/**
 * Payroll.
 *
 * Refuses to prepare a run while any attendance day still needs review — paying an
 * unreviewed day is exactly how a wage dispute starts, and the fix is cheap before the
 * cash is handed over and expensive after.
 */
function Payroll() {
  const dict = useDict();
  const { branchId, can } = useSession();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [draft, setDraft] = useState<PayrollRun | null>(null);

  const runs = useQuery({
    queryKey: ['payroll', branchId],
    enabled: !!branchId,
    queryFn: () => get<PayrollRun[]>(`/staff/payroll/${branchId}`),
  });

  const prepare = useMutation({
    mutationFn: () => post<PayrollRun>('/staff/payroll/prepare', { branchId, period }),
    onSuccess: (run) => {
      setDraft(run);
      void queryClient.invalidateQueries({ queryKey: ['payroll', branchId] });
    },
  });

  const approve = useMutation({
    mutationFn: (id: string) => post(`/staff/payroll/${id}/approve`),
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['payroll', branchId] });
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Period" hint="Salaries fall due on the 10th">
            <input className={inputClass} type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
          {can('payroll:run') ? (
            <Button disabled={prepare.isPending} onClick={() => prepare.mutate()}>
              {prepare.isPending ? dict.common.loading : 'Prepare'}
            </Button>
          ) : null}
        </div>
        <ErrorNote error={prepare.error} />
      </Card>

      {draft ? (
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">
              {draft.period} · <Badge tone={draft.status === 'DRAFT' ? 'warn' : 'good'}>{draft.status}</Badge>
            </h2>
            <span className="text-sm">
              Net <strong className="tabular-nums">{formatMinor(draft.netMinor)}</strong>
            </span>
          </div>

          <Table head={[dict.common.name, 'Present', 'Absent', 'OT', 'Basic', 'Advance', 'Net']}>
            {(draft.lines ?? []).map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-2">
                  <div className="font-medium">{l.employee.name}</div>
                  <div className="text-xs text-ink-400">{l.employee.employeeCode}</div>
                </td>
                <td className="px-3 py-2 tabular-nums">{Number(l.presentDays).toFixed(1)}</td>
                <td className="px-3 py-2 tabular-nums">{Number(l.absentDays).toFixed(1)}</td>
                <td className="px-3 py-2 tabular-nums">{(l.overtimeMinutes / 60).toFixed(1)}h</td>
                <td className="px-3 py-2 tabular-nums">{formatMinor(l.basicMinor)}</td>
                <td className="px-3 py-2 tabular-nums text-amber-700">
                  {l.advanceDeductionMinor ? `-${formatMinor(l.advanceDeductionMinor)}` : '—'}
                </td>
                <td className="px-3 py-2 font-semibold tabular-nums">{formatMinor(l.netMinor)}</td>
              </tr>
            ))}
          </Table>

          {can('payroll:approve') && draft.status === 'DRAFT' ? (
            <>
              <p className="mt-3 text-xs text-ink-400">
                Approving freezes the attendance days this run pays, so history cannot change under a payslip
                already handed over.
              </p>
              <Button className="mt-2" disabled={approve.isPending} onClick={() => approve.mutate(draft.id)}>
                {approve.isPending ? dict.common.saving : 'Approve'}
              </Button>
              <ErrorNote error={approve.error} />
            </>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <h2 className="font-medium">History</h2>
        {(runs.data?.length ?? 0) === 0 ? (
          <Empty>{dict.common.noData}</Empty>
        ) : (
          <Table head={['Period', dict.common.status, 'Pay date', 'Gross', 'Deductions', 'Net']}>
            {(runs.data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 font-medium">{r.period}</td>
                <td className="px-3 py-2">
                  <Badge tone={r.status === 'PAID' ? 'good' : r.status === 'APPROVED' ? 'brand' : 'warn'}>
                    {r.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 tabular-nums">{r.payDate.slice(0, 10)}</td>
                <td className="px-3 py-2 tabular-nums">{formatMinor(r.grossMinor)}</td>
                <td className="px-3 py-2 tabular-nums">{formatMinor(r.deductionsMinor)}</td>
                <td className="px-3 py-2 font-semibold tabular-nums">{formatMinor(r.netMinor)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
