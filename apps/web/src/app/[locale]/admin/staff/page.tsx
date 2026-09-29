'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EMPLOYEE_ROLE_TYPES, EMPLOYMENT_TYPES, formatMinor } from '@mk/shared';
import { Badge, Button, Card, Empty, ErrorNote, Field, Table, inputClass } from '@/components/ui';
import {
  CheckField,
  FormDialog,
  FormGrid,
  FullWidth,
  MoneyField,
  NumberField,
  SelectField,
  TextField,
  Toolbar,
} from '@/components/admin/form';
import { StaffShell } from '@/components/staff-shell';
import { get, post, put } from '@/lib/api';
import { useDict } from '@/lib/dict';
import { useSession } from '@/lib/session';

interface Employee {
  id: string;
  branchId: string;
  employeeCode: string;
  name: string;
  phone: string | null;
  altPhone: string | null;
  addressLine1: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  roleType: string;
  employmentType: string;
  joinedOn: string;
  isActive: boolean;
  weeklyOffDay: number | null;
  notes: string | null;
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
  const [tab, setTab] = useState<'PEOPLE' | 'SHIFTS' | 'PAYROLL'>('PEOPLE');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['PEOPLE', dict.admin.staff],
            ['SHIFTS', 'Shifts'],
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
      {tab === 'SHIFTS' ? <Shifts /> : null}
      {tab === 'PAYROLL' ? (can('payroll:read') ? <Payroll /> : <Empty>{dict.auth.noAccess}</Empty>) : null}
    </div>
  );
}

function People() {
  const dict = useDict();
  const { branchId, can } = useSession();
  const queryClient = useQueryClient();
  const [advanceFor, setAdvanceFor] = useState<Employee | null>(null);
  const [editing, setEditing] = useState<Employee | 'NEW' | null>(null);
  const [salaryFor, setSalaryFor] = useState<Employee | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);

  const query = useQuery({
    queryKey: ['employees', branchId, includeInactive],
    enabled: !!branchId,
    queryFn: () =>
      get<Employee[]>(`/staff/employees?branchId=${branchId}&includeInactive=${includeInactive}`),
  });

  const showSalary = can('salary:read');
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['employees'] });

  return (
    <div className="space-y-3">
      <Toolbar>
        <Button variant="secondary" onClick={() => setIncludeInactive((v) => !v)}>
          {includeInactive ? 'Showing everyone' : 'Showing current staff'}
        </Button>
        {can('employee:write') ? (
          <div className="ml-auto">
            <Button onClick={() => setEditing('NEW')}>Add employee</Button>
          </div>
        ) : null}
      </Toolbar>

      <ErrorNote error={query.error} />
      <Table
        head={[
          dict.common.name,
          'Role',
          dict.common.phone,
          ...(showSalary ? ['Salary'] : []),
          'Joined',
          'Card / PIN',
          ...(can('employee:write') || can('salary:write') ? [dict.common.actions] : []),
        ]}
      >
        {(query.data ?? []).map((e) => {
          const salary = e.salaryStructures[0];
          return (
            <tr key={e.id} className={e.isActive ? undefined : 'opacity-50'}>
              <td className="px-3 py-2">
                <div className="font-medium">{e.name}</div>
                <div className="text-xs text-ink-400">
                  {e.employeeCode}
                  {e.isActive ? '' : ' · left'}
                </div>
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
              {can('employee:write') || can('salary:write') ? (
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    {can('employee:write') ? (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>
                        Edit
                      </Button>
                    ) : null}
                    {can('salary:write') ? (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => setSalaryFor(e)}>
                          {salary ? 'Change pay' : 'Set pay'}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setAdvanceFor(e)}>
                          Advance
                        </Button>
                      </>
                    ) : null}
                  </div>
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
            refresh();
          }}
        />
      ) : null}

      {editing ? (
        <EmployeeDialog
          employee={editing === 'NEW' ? null : editing}
          branchId={branchId!}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      ) : null}

      {salaryFor ? (
        <SalaryDialog
          employee={salaryFor}
          onClose={() => setSalaryFor(null)}
          onDone={() => {
            setSalaryFor(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Add or edit an employee.
 *
 * The fields that look optional are not decorative. The emergency contact is the number
 * someone calls at 9pm when a cook cuts a hand; the weekly off is what stops the payroll
 * run marking a legitimate rest day absent; the ID proof is last-four only, and Aadhaar is
 * deliberately not accepted anywhere in this system — storing it creates an obligation the
 * business has no way to discharge.
 */
function EmployeeDialog({
  employee,
  branchId,
  onClose,
  onDone,
}: {
  employee: Employee | null;
  branchId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    employeeCode: employee?.employeeCode ?? '',
    name: employee?.name ?? '',
    phone: employee?.phone ?? '',
    altPhone: employee?.altPhone ?? '',
    addressLine1: employee?.addressLine1 ?? '',
    emergencyContactName: employee?.emergencyContactName ?? '',
    emergencyContactPhone: employee?.emergencyContactPhone ?? '',
    roleType: employee?.roleType ?? 'HELPER',
    employmentType: employee?.employmentType ?? 'FULL_TIME',
    joinedOn: employee?.joinedOn?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    weeklyOffDay: employee?.weeklyOffDay ?? 1,
    notes: employee?.notes ?? '',
    isActive: employee?.isActive ?? true,
  });

  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        branchId: employee?.branchId ?? branchId,
        employeeCode: f.employeeCode.trim(),
        name: f.name.trim(),
        roleType: f.roleType,
        employmentType: f.employmentType,
        joinedOn: f.joinedOn,
        weeklyOffDay: f.weeklyOffDay,
        isActive: f.isActive,
        ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
        ...(f.altPhone.trim() ? { altPhone: f.altPhone.trim() } : {}),
        ...(f.addressLine1.trim() ? { addressLine1: f.addressLine1.trim() } : {}),
        ...(f.emergencyContactName.trim() ? { emergencyContactName: f.emergencyContactName.trim() } : {}),
        ...(f.emergencyContactPhone.trim() ? { emergencyContactPhone: f.emergencyContactPhone.trim() } : {}),
        ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
      };
      return employee ? put(`/staff/employees/${employee.id}`, body) : post('/staff/employees', body);
    },
    onSuccess: onDone,
  });

  return (
    <FormDialog
      title={employee ? `Edit ${employee.name}` : 'Add an employee'}
      subtitle={employee ? employee.employeeCode : 'Pay is set separately, on the next screen'}
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={f.name.trim().length < 2 || f.employeeCode.trim() === ''}
      submitLabel={employee ? 'Save' : 'Add'}
      wide
    >
      <FormGrid>
        <TextField label="Name" value={f.name} onChange={set('name')} required autoFocus />
        <TextField
          label="Employee code"
          value={f.employeeCode}
          onChange={set('employeeCode')}
          required
          placeholder="MK-007"
          hint="What appears on the payslip and the attendance sheet"
        />
        <SelectField
          label="Role"
          value={f.roleType}
          onChange={set('roleType')}
          options={EMPLOYEE_ROLE_TYPES.map((r) => ({ value: r, label: r.replace(/_/g, ' ').toLowerCase() }))}
        />
        <SelectField
          label="Employment"
          value={f.employmentType}
          onChange={set('employmentType')}
          options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ').toLowerCase() }))}
        />
        <TextField label="Joined on" value={f.joinedOn} onChange={set('joinedOn')} type="date" required />
        <SelectField
          label="Weekly off"
          value={String(f.weeklyOffDay)}
          onChange={(v) => set('weeklyOffDay')(Number(v))}
          hint="Attendance marks this day off rather than absent"
          options={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
            (d, i) => ({ value: String(i), label: d }),
          )}
        />
        <TextField label="Phone" value={f.phone} onChange={set('phone')} placeholder="98765 43210" />
        <TextField label="Alternate phone" value={f.altPhone} onChange={set('altPhone')} />
        <TextField
          label="Emergency contact"
          value={f.emergencyContactName}
          onChange={set('emergencyContactName')}
          hint="Who to call, and this is why it matters more than it looks"
        />
        <TextField
          label="Emergency phone"
          value={f.emergencyContactPhone}
          onChange={set('emergencyContactPhone')}
        />
      </FormGrid>

      <FullWidth>
        <TextField label="Address" value={f.addressLine1} onChange={set('addressLine1')} />
      </FullWidth>
      <FullWidth>
        <TextField label="Notes" value={f.notes} onChange={set('notes')} />
      </FullWidth>

      {employee ? (
        <CheckField
          label="Still working here"
          checked={f.isActive}
          onChange={set('isActive')}
          hint="Unticking hides them from rosters and payroll. Their attendance and payslip history stays — the database refuses to delete it, which is what makes an old wage dispute answerable."
        />
      ) : null}
    </FormDialog>
  );
}

/**
 * Set or change pay.
 *
 * Versioned rather than edited: a raise creates a new structure effective from a date, and
 * the old payslips keep pointing at the rate that actually paid them. Editing the number in
 * place would silently rewrite history, and the person who notices is the employee holding
 * a payslip that no longer matches the system.
 */
function SalaryDialog({
  employee,
  onClose,
  onDone,
}: {
  employee: Employee;
  onClose: () => void;
  onDone: () => void;
}) {
  const current = employee.salaryStructures[0];
  const [basis, setBasis] = useState(current?.basis ?? 'MONTHLY');
  const [monthlyGrossMinor, setMonthly] = useState(current?.monthlyGrossMinor ?? 0);
  const [dailyRateMinor, setDaily] = useState(current?.dailyRateMinor ?? 0);
  const [payDayOfMonth, setPayDay] = useState(String(current?.payDayOfMonth ?? 10));
  const [overtimeRateMultiplier, setOt] = useState('2');
  const [effectiveFrom, setFrom] = useState(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
  });

  const mutation = useMutation({
    mutationFn: () =>
      post('/staff/salary', {
        employeeId: employee.id,
        effectiveFrom,
        basis,
        ...(basis === 'MONTHLY' ? { monthlyGrossMinor } : { dailyRateMinor }),
        payDayOfMonth: Number(payDayOfMonth),
        overtimeRateMultiplier: Number(overtimeRateMultiplier),
      }),
    onSuccess: onDone,
  });

  const amountSet = basis === 'MONTHLY' ? monthlyGrossMinor > 0 : dailyRateMinor > 0;

  return (
    <FormDialog
      title={`Pay for ${employee.name}`}
      subtitle={
        current
          ? `Currently ${
              current.basis === 'DAILY'
                ? `${formatMinor(current.dailyRateMinor ?? 0)} a day`
                : `${formatMinor(current.monthlyGrossMinor ?? 0)} a month`
            }`
          : 'No pay set yet — payroll will skip this person until it is'
      }
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={!amountSet}
      submitLabel="Save"
    >
      <FormGrid>
        <SelectField
          label="Paid"
          value={basis}
          onChange={setBasis}
          options={[
            { value: 'MONTHLY', label: 'Monthly salary' },
            { value: 'DAILY', label: 'Daily wage' },
          ]}
        />
        {basis === 'MONTHLY' ? (
          <MoneyField label="Monthly gross" minor={monthlyGrossMinor} onChange={setMonthly} required />
        ) : (
          <MoneyField label="Daily rate" minor={dailyRateMinor} onChange={setDaily} required />
        )}
        <TextField
          label="Effective from"
          value={effectiveFrom}
          onChange={setFrom}
          type="date"
          required
          hint="Payslips before this date keep the old rate"
        />
        <NumberField
          label="Pay day"
          value={payDayOfMonth}
          onChange={setPayDay}
          min={1}
          max={28}
          hint="Day of the month wages are handed over"
        />
        <NumberField
          label="Overtime rate"
          value={overtimeRateMultiplier}
          onChange={setOt}
          min={1}
          max={3}
          step="0.5"
          suffix="×"
        />
      </FormGrid>
    </FormDialog>
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

interface Shift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  graceMinutes: number;
  fullDayMinutes: number;
  isActive: boolean;
  assignments: {
    id: string;
    daysOfWeek: number[];
    effectiveFrom: string;
    effectiveTo: string | null;
    employee: { id: string; name: string; employeeCode: string; roleType: string };
  }[];
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Shifts, and who works them.
 *
 * This is what turns a pile of punches into a day's attendance. Without a shift the system
 * cannot tell a late arrival from an early one, cannot compute overtime, and cannot decide
 * whether four hours is a half day — so it marks the day NEEDS_REVIEW and payroll refuses
 * to run. Defining the two or three shifts a kitchen actually works is a ten-minute job
 * that removes a recurring one.
 *
 * The grace period is the humane part: ten minutes means the cook who is three minutes
 * late because of traffic is not docked, and the manager is not asked to adjudicate it.
 */
function Shifts() {
  const { branchId, can } = useSession();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Shift | 'NEW' | null>(null);
  const [assigning, setAssigning] = useState<Shift | null>(null);

  const shifts = useQuery({
    queryKey: ['shifts', branchId],
    enabled: !!branchId,
    queryFn: () => get<Shift[]>(`/staff/shifts/${branchId}`),
  });

  const employees = useQuery({
    queryKey: ['employees', branchId, false],
    enabled: !!branchId,
    queryFn: () => get<Employee[]>(`/staff/employees?branchId=${branchId}&includeInactive=false`),
  });

  const rows = shifts.data ?? [];

  return (
    <div className="space-y-3">
      <Toolbar>
        <p className="text-sm text-ink-600">
          A punch is only readable against a shift. Days without one are held for review and payroll will not
          pay them.
        </p>
        {can('shift:write') ? (
          <div className="ml-auto">
            <Button onClick={() => setEditing('NEW')}>New shift</Button>
          </div>
        ) : null}
      </Toolbar>

      <ErrorNote error={shifts.error} />

      {rows.length === 0 ? (
        <Empty>No shifts defined for this branch yet.</Empty>
      ) : (
        <Table
          head={[
            'Shift',
            'Hours',
            'Break',
            'Grace',
            'Full day',
            'Who works it',
            ...(can('shift:write') ? [''] : []),
          ]}
        >
          {rows.map((sh) => (
            <tr key={sh.id} className={sh.isActive ? undefined : 'opacity-50'}>
              <td className="px-3 py-2 align-top">
                <div className="font-medium">{sh.name}</div>
                {sh.isActive ? null : <Badge tone="neutral">retired</Badge>}
              </td>
              <td className="px-3 py-2 align-top tabular-nums">
                {sh.startTime} – {sh.endTime}
              </td>
              <td className="px-3 py-2 align-top tabular-nums">{sh.breakMinutes} min</td>
              <td className="px-3 py-2 align-top tabular-nums">{sh.graceMinutes} min</td>
              <td className="px-3 py-2 align-top tabular-nums">{(sh.fullDayMinutes / 60).toFixed(1)} h</td>
              <td className="px-3 py-2 align-top">
                {sh.assignments.length === 0 ? (
                  <span className="text-sm text-ink-400">nobody yet</span>
                ) : (
                  <div className="space-y-1">
                    {sh.assignments.map((a) => (
                      <div key={a.id} className="text-sm">
                        <span className="font-medium">{a.employee.name}</span>{' '}
                        <span className="text-xs text-ink-400">
                          {a.daysOfWeek.length === 0 || a.daysOfWeek.length === 7
                            ? 'every day'
                            : a.daysOfWeek.map((d) => DAY_NAMES[d]).join(' ')}
                          {a.effectiveTo ? ` · until ${a.effectiveTo.slice(0, 10)}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </td>
              {can('shift:write') ? (
                <td className="px-3 py-2 align-top">
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(sh)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setAssigning(sh)}>
                      Assign
                    </Button>
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      )}

      {editing ? (
        <ShiftDialog
          shift={editing === 'NEW' ? null : editing}
          branchId={branchId!}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['shifts', branchId] });
          }}
        />
      ) : null}

      {assigning ? (
        <AssignShiftDialog
          shift={assigning}
          employees={employees.data ?? []}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            void queryClient.invalidateQueries({ queryKey: ['shifts', branchId] });
          }}
        />
      ) : null}
    </div>
  );
}

function ShiftDialog({
  shift,
  branchId,
  onClose,
  onDone,
}: {
  shift: Shift | null;
  branchId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    name: shift?.name ?? '',
    startTime: shift?.startTime ?? '09:00',
    endTime: shift?.endTime ?? '17:00',
    breakMinutes: String(shift?.breakMinutes ?? 30),
    graceMinutes: String(shift?.graceMinutes ?? 10),
    fullDayMinutes: String(shift?.fullDayMinutes ?? 480),
    isActive: shift?.isActive ?? true,
  });

  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const mutation = useMutation({
    mutationFn: () =>
      post('/staff/shifts', {
        branchId,
        name: f.name.trim(),
        startTime: f.startTime,
        endTime: f.endTime,
        breakMinutes: Number(f.breakMinutes),
        graceMinutes: Number(f.graceMinutes),
        fullDayMinutes: Number(f.fullDayMinutes),
        isActive: f.isActive,
      }),
    onSuccess: onDone,
  });

  return (
    <FormDialog
      title={shift ? `Edit ${shift.name}` : 'New shift'}
      subtitle="Shifts are per branch — a second kitchen can run different hours"
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={f.name.trim().length < 2}
      submitLabel="Save"
    >
      <FormGrid>
        <TextField
          label="Name"
          value={f.name}
          onChange={set('name')}
          required
          autoFocus
          placeholder="Morning kitchen"
        />
        <TextField label="Starts" value={f.startTime} onChange={set('startTime')} type="time" required />
        <TextField label="Ends" value={f.endTime} onChange={set('endTime')} type="time" required />
        <NumberField label="Break" value={f.breakMinutes} onChange={set('breakMinutes')} min={0} max={240} suffix="min" />
        <NumberField
          label="Grace"
          value={f.graceMinutes}
          onChange={set('graceMinutes')}
          min={0}
          max={60}
          suffix="min"
          hint="Arriving within this is on time. Ten minutes stops traffic becoming a wage argument."
        />
        <NumberField
          label="Full day"
          value={f.fullDayMinutes}
          onChange={set('fullDayMinutes')}
          min={60}
          max={960}
          suffix="min"
          hint="Below half of this the day counts as a half day"
        />
      </FormGrid>
      {shift ? <CheckField label="In use" checked={f.isActive} onChange={set('isActive')} /> : null}
    </FormDialog>
  );
}

/**
 * Put someone on a shift, from a date, on chosen days.
 *
 * Effective-dated rather than replaced, for the same reason salary is: last month's
 * attendance must stay readable against the shift that was actually in force then.
 */
function AssignShiftDialog({
  shift,
  employees,
  onClose,
  onDone,
}: {
  shift: Shift;
  employees: Employee[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [effectiveFrom, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [effectiveTo, setTo] = useState('');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);

  const mutation = useMutation({
    mutationFn: () =>
      post('/staff/shift-assignments', {
        employeeId,
        shiftId: shift.id,
        effectiveFrom,
        ...(effectiveTo ? { effectiveTo } : {}),
        daysOfWeek: days,
      }),
    onSuccess: onDone,
  });

  const selected = employees.find((e) => e.id === employeeId);

  return (
    <FormDialog
      title={`Assign ${shift.name}`}
      subtitle={`${shift.startTime} – ${shift.endTime}`}
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={!employeeId || days.length === 0}
      submitLabel="Assign"
    >
      <SelectField
        label="Employee"
        value={employeeId}
        onChange={setEmployeeId}
        required
        placeholder="Pick someone…"
        options={employees.map((e) => ({
          value: e.id,
          label: `${e.name} · ${e.roleType.replace(/_/g, ' ').toLowerCase()}`,
        }))}
      />

      <Field label="Days" hint="Untick the weekly off — a day worked off-roster still records, it just is not expected">
        <div className="flex flex-wrap gap-1.5">
          {DAY_NAMES.map((d, i) => {
            const on = days.includes(i);
            const isWeeklyOff = selected?.weeklyOffDay === i;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => setDays((prev) => (on ? prev.filter((x) => x !== i) : [...prev, i].sort()))}
                className={`pos-tap rounded-lg border px-3 py-2 text-sm font-semibold ${
                  on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-600'
                }`}
                title={isWeeklyOff ? 'This is their weekly off' : undefined}
              >
                {d}
                {isWeeklyOff ? '*' : ''}
              </button>
            );
          })}
        </div>
      </Field>

      <FormGrid>
        <TextField label="From" value={effectiveFrom} onChange={setFrom} type="date" required />
        <TextField
          label="Until"
          value={effectiveTo}
          onChange={setTo}
          type="date"
          hint="Leave blank for open-ended"
        />
      </FormGrid>
    </FormDialog>
  );
}
