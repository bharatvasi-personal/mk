'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, Empty, ErrorNote, Field, Table, inputClass } from '@/components/ui';
import { StaffShell } from '@/components/staff-shell';
import { get, post } from '@/lib/api';
import { useDict, useLocale } from '@/lib/dict';
import { useSession } from '@/lib/session';

interface DayRow {
  id: string;
  employeeId: string;
  workDate: string;
  firstInAt: string | null;
  lastOutAt: string | null;
  workedMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  status: string;
  needsReviewReason: string | null;
  lockedByPayrollRunId: string | null;
  employee: { name: string; employeeCode: string; roleType?: string };
}

export default function AttendanceAdminPage() {
  return (
    <StaffShell requires="attendance:read:all" title="Attendance">
      <AttendanceAdmin />
    </StaffShell>
  );
}

function AttendanceAdmin() {
  const dict = useDict();
  const locale = useLocale();
  const { branchId, can } = useSession();
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(() => new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [correcting, setCorrecting] = useState<DayRow | null>(null);

  const review = useQuery({
    queryKey: ['attendance-review', branchId],
    enabled: !!branchId,
    queryFn: () => get<DayRow[]>(`/attendance/needs-review/${branchId}`),
  });

  const range = useQuery({
    queryKey: ['attendance-range', branchId, from, to],
    enabled: !!branchId,
    queryFn: () => get<DayRow[]>(`/attendance/range/${branchId}?from=${from}&to=${to}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/${locale}/punch`}
          className="pos-tap rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
        >
          {dict.attendance.punchIn} / {dict.attendance.punchOut}
        </Link>
        <Field label={dict.common.from}>
          <input className={inputClass} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={dict.common.to}>
          <input className={inputClass} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>

      {(review.data?.length ?? 0) > 0 ? (
        <Card className="!border-amber-300 !bg-amber-50">
          <h2 className="font-medium text-amber-900">
            {review.data!.length} {dict.attendance.needsReview}
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            Payroll will not run until these are resolved. The system refuses to guess at an unpaired punch — a
            plausible-looking wrong number is worse than a visible gap.
          </p>
          <Table head={[dict.common.name, dict.common.date, 'Reason', dict.common.actions]}>
            {review.data!.map((d) => (
              <tr key={d.id}>
                <td className="px-3 py-2">{d.employee.name}</td>
                <td className="px-3 py-2 tabular-nums">{d.workDate.slice(0, 10)}</td>
                <td className="px-3 py-2 text-amber-900">{d.needsReviewReason}</td>
                <td className="px-3 py-2">
                  {can('attendance:correct') ? (
                    <Button size="sm" onClick={() => setCorrecting(d)}>
                      {dict.common.edit}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}

      <ErrorNote error={range.error} />

      {(range.data?.length ?? 0) === 0 ? (
        <Empty>{dict.common.noData}</Empty>
      ) : (
        <Table
          head={[
            dict.common.date,
            dict.common.name,
            dict.attendance.punchIn,
            dict.attendance.punchOut,
            dict.attendance.hoursWorked,
            dict.attendance.overtime,
            dict.attendance.late,
            dict.common.status,
            ...(can('attendance:correct') ? [dict.common.actions] : []),
          ]}
        >
          {(range.data ?? []).map((d) => (
            <tr key={d.id}>
              <td className="px-3 py-2 tabular-nums">{d.workDate.slice(0, 10)}</td>
              <td className="px-3 py-2">{d.employee.name}</td>
              <td className="px-3 py-2 tabular-nums">{d.firstInAt ? timeOf(d.firstInAt) : '—'}</td>
              <td className="px-3 py-2 tabular-nums">{d.lastOutAt ? timeOf(d.lastOutAt) : '—'}</td>
              <td className="px-3 py-2 tabular-nums">{(d.workedMinutes / 60).toFixed(1)}h</td>
              <td className="px-3 py-2 tabular-nums">{d.overtimeMinutes ? `${(d.overtimeMinutes / 60).toFixed(1)}h` : '—'}</td>
              <td className="px-3 py-2 tabular-nums">{d.lateMinutes ? `${d.lateMinutes}m` : '—'}</td>
              <td className="px-3 py-2">
                <Badge
                  tone={
                    d.status === 'PRESENT'
                      ? 'good'
                      : d.status === 'ABSENT'
                        ? 'bad'
                        : d.status === 'NEEDS_REVIEW' || d.status === 'HALF_DAY'
                          ? 'warn'
                          : 'neutral'
                  }
                >
                  {d.status.replace('_', ' ').toLowerCase()}
                </Badge>
                {d.lockedByPayrollRunId ? <div className="mt-0.5 text-xs text-ink-400">paid</div> : null}
              </td>
              {can('attendance:correct') ? (
                <td className="px-3 py-2">
                  <Button size="sm" variant="secondary" disabled={!!d.lockedByPayrollRunId} onClick={() => setCorrecting(d)}>
                    {dict.common.edit}
                  </Button>
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      )}

      {correcting ? (
        <CorrectDialog
          day={correcting}
          onClose={() => setCorrecting(null)}
          onDone={() => {
            setCorrecting(null);
            void queryClient.invalidateQueries({ queryKey: ['attendance-review', branchId] });
            void queryClient.invalidateQueries({ queryKey: ['attendance-range', branchId, from, to] });
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Correcting a day.
 *
 * The raw punches are never touched — they are immutable evidence. This writes a
 * reviewed, reasoned override on the *derived* day, and the reason is mandatory because
 * "the manager changed my hours" needs an answer six weeks later.
 */
function CorrectDialog({ day, onClose, onDone }: { day: DayRow; onClose: () => void; onDone: () => void }) {
  const dict = useDict();
  const [firstIn, setFirstIn] = useState(day.firstInAt ? toLocal(day.firstInAt) : '');
  const [lastOut, setLastOut] = useState(day.lastOutAt ? toLocal(day.lastOutAt) : '');
  const [status, setStatus] = useState(day.status === 'NEEDS_REVIEW' ? 'PRESENT' : day.status);
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      post('/attendance/correct', {
        employeeId: day.employeeId,
        workDate: day.workDate.slice(0, 10),
        firstInAt: firstIn ? new Date(firstIn).toISOString() : null,
        lastOutAt: lastOut ? new Date(lastOut).toISOString() : null,
        status,
        reason,
      }),
    onSuccess: onDone,
  });

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink-900/50 p-4">
      <Card className="w-full max-w-sm">
        <h2 className="font-display text-lg font-semibold">{day.employee.name}</h2>
        <p className="text-sm text-ink-400">{day.workDate.slice(0, 10)}</p>
        {day.needsReviewReason ? (
          <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{day.needsReviewReason}</p>
        ) : null}

        <div className="mt-4 space-y-3">
          <Field label={dict.attendance.punchIn}>
            <input className={inputClass} type="datetime-local" value={firstIn} onChange={(e) => setFirstIn(e.target.value)} />
          </Field>
          <Field label={dict.attendance.punchOut}>
            <input className={inputClass} type="datetime-local" value={lastOut} onChange={(e) => setLastOut(e.target.value)} />
          </Field>
          <Field label={dict.common.status}>
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
              {['PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE', 'WEEKLY_OFF', 'HOLIDAY'].map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ').toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reason" hint="Recorded in the audit trail — required">
            <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorNote error={mutation.error} />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={onClose}>
              {dict.common.cancel}
            </Button>
            <Button disabled={reason.trim().length < 3 || mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? dict.common.saving : dict.common.save}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
}

function toLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
