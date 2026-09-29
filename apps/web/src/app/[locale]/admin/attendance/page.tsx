'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ATTENDANCE_SOURCES, CREDENTIAL_TYPES } from '@mk/shared';
import { Badge, Button, Card, Empty, ErrorNote, Field, Table, inputClass } from '@/components/ui';
import { FormDialog, FormGrid, SelectField, TextField, Toolbar } from '@/components/admin/form';
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
  const { can } = useSession();
  const [tab, setTab] = useState<'DAYS' | 'DEVICES'>('DAYS');

  if (!can('attendance:device:manage')) return <AttendanceDays />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['DAYS', 'Day sheet'],
            ['DEVICES', 'Readers & cards'],
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

      {tab === 'DAYS' ? <AttendanceDays /> : <Devices />}
    </div>
  );
}

function AttendanceDays() {
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

interface DeviceRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  location: string | null;
  lastSeenAt: string | null;
  clockSkewSeconds: number;
  isActive: boolean;
  createdAt: string;
  _count: { events: number };
}

interface CredentialEmployee {
  id: string;
  name: string;
  employeeCode: string;
  roleType: string;
  credentials: { id: string; type: string; identifier: string; issuedOn?: string }[];
}

/**
 * Readers and cards.
 *
 * The punch API was built source-agnostic from day one — a QR scan, a PIN, an NFC tap and
 * a fingerprint reader all post the same shape — so adding hardware later is an
 * integration, not a rewrite. This screen is where that promise gets cashed: register the
 * reader, issue the cards, and revoke the one that walked out of the building.
 *
 * Nothing here is required at launch. The shop opens on QR and PIN, which cost nothing and
 * work on a phone the staff already own.
 */
function Devices() {
  const { branchId } = useSession();
  const queryClient = useQueryClient();
  const [registering, setRegistering] = useState(false);
  const [issuingFor, setIssuingFor] = useState<CredentialEmployee | null>(null);
  const [revoking, setRevoking] = useState<{ id: string; label: string } | null>(null);
  const [secret, setSecret] = useState<{ code: string; secret: string } | null>(null);

  const devices = useQuery({
    queryKey: ['attendance-devices', branchId],
    enabled: !!branchId,
    queryFn: () => get<DeviceRow[]>(`/attendance/devices/${branchId}`),
  });

  const employees = useQuery({
    queryKey: ['employees', branchId, false],
    enabled: !!branchId,
    queryFn: () => get<CredentialEmployee[]>(`/staff/employees?branchId=${branchId}&includeInactive=false`),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['attendance-devices', branchId] });
    void queryClient.invalidateQueries({ queryKey: ['employees'] });
  };

  return (
    <div className="space-y-4">
      {secret ? (
        <Card className="!border-amber-300 !bg-amber-50">
          <h2 className="font-medium text-amber-900">Shared secret for {secret.code}</h2>
          <p className="mt-1 text-sm text-amber-800">
            Copy this onto the device now. It is stored hashed and cannot be shown again — a device whose
            secret is lost is re-registered, not recovered.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-white p-3 font-mono text-sm">{secret.secret}</pre>
          <Button className="mt-3" variant="secondary" onClick={() => setSecret(null)}>
            I have copied it
          </Button>
        </Card>
      ) : null}

      <Card>
        <Toolbar>
          <div>
            <h2 className="font-medium">Punch readers</h2>
            <p className="mt-0.5 text-sm text-ink-600">
              Optional. The shop runs on QR and PIN at launch, which cost nothing.
            </p>
          </div>
          <div className="ml-auto">
            <Button onClick={() => setRegistering(true)}>Register reader</Button>
          </div>
        </Toolbar>

        <ErrorNote error={devices.error} />

        {(devices.data?.length ?? 0) === 0 ? (
          <Empty>No readers registered at this branch.</Empty>
        ) : (
          <Table head={['Reader', 'Kind', 'Where', 'Last seen', 'Punches', 'Clock drift']}>
            {(devices.data ?? []).map((d) => (
              <tr key={d.id} className={d.isActive ? undefined : 'opacity-50'}>
                <td className="px-3 py-2">
                  <div className="font-medium">{d.name}</div>
                  <div className="font-mono text-xs text-ink-400">{d.code}</div>
                </td>
                <td className="px-3 py-2 text-sm">{d.kind.replace(/_/g, ' ').toLowerCase()}</td>
                <td className="px-3 py-2 text-sm">{d.location ?? '—'}</td>
                <td className="px-3 py-2 text-sm tabular-nums">
                  {d.lastSeenAt
                    ? new Date(d.lastSeenAt).toLocaleString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })
                    : 'never'}
                </td>
                <td className="px-3 py-2 tabular-nums">{d._count.events}</td>
                <td className="px-3 py-2 tabular-nums">
                  {d.clockSkewSeconds ? `${d.clockSkewSeconds}s` : '—'}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <h2 className="font-medium">Cards and PINs</h2>
        <p className="mt-0.5 text-sm text-ink-600">
          A PIN is hashed like a password and never shown again. A card that walks out of the building gets
          revoked here, with a reason.
        </p>

        <ErrorNote error={employees.error} />

        <Table head={['Who', 'Role', 'Issued', '']}>
          {(employees.data ?? []).map((e) => (
            <tr key={e.id}>
              <td className="px-3 py-2">
                <div className="font-medium">{e.name}</div>
                <div className="text-xs text-ink-400">{e.employeeCode}</div>
              </td>
              <td className="px-3 py-2 text-sm">{e.roleType.replace(/_/g, ' ').toLowerCase()}</td>
              <td className="px-3 py-2">
                {e.credentials.length === 0 ? (
                  <span className="text-sm text-ink-400">none</span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {e.credentials.map((c) => (
                      <span key={c.id} className="inline-flex items-center gap-1">
                        <Badge tone="neutral">
                          {c.type === 'PIN' ? 'PIN' : `${c.type.replace(/_/g, ' ').toLowerCase()} ${c.identifier}`}
                        </Badge>
                        <button
                          type="button"
                          className="text-xs text-red-600 underline"
                          onClick={() => setRevoking({ id: c.id, label: `${e.name} · ${c.type}` })}
                        >
                          revoke
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </td>
              <td className="px-3 py-2">
                <Button size="sm" variant="secondary" onClick={() => setIssuingFor(e)}>
                  Issue
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      {registering ? (
        <RegisterDeviceDialog
          branchId={branchId!}
          onClose={() => setRegistering(false)}
          onDone={(s) => {
            setRegistering(false);
            setSecret(s);
            refresh();
          }}
        />
      ) : null}

      {issuingFor ? (
        <IssueCredentialDialog
          employee={issuingFor}
          onClose={() => setIssuingFor(null)}
          onDone={() => {
            setIssuingFor(null);
            refresh();
          }}
        />
      ) : null}

      {revoking ? (
        <RevokeDialog
          credential={revoking}
          onClose={() => setRevoking(null)}
          onDone={() => {
            setRevoking(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function RegisterDeviceDialog({
  branchId,
  onClose,
  onDone,
}: {
  branchId: string;
  onClose: () => void;
  onDone: (secret: { code: string; secret: string }) => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('NFC');
  const [location, setLocation] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      post<{ device: { code: string }; secret: string }>('/attendance/devices', {
        branchId,
        code: code.trim(),
        name: name.trim(),
        kind,
        ...(location.trim() ? { location: location.trim() } : {}),
      }),
    onSuccess: (r) => onDone({ code: r.device.code, secret: r.secret }),
  });

  return (
    <FormDialog
      title="Register a punch reader"
      subtitle="The shared secret is shown once, immediately after this"
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={code.trim() === '' || name.trim() === ''}
      submitLabel="Register"
    >
      <FormGrid>
        <TextField label="Name" value={name} onChange={setName} required autoFocus placeholder="Back door reader" />
        <TextField
          label="Device code"
          value={code}
          onChange={setCode}
          required
          placeholder="RDR-01"
          hint="What the device sends to identify itself"
        />
        <SelectField
          label="Kind"
          value={kind}
          onChange={setKind}
          options={ATTENDANCE_SOURCES.filter((s) => !['MANUAL', 'IMPORT', 'WEB'].includes(s)).map((s) => ({
            value: s,
            label: s.replace(/_/g, ' ').toLowerCase(),
          }))}
        />
        <TextField label="Where" value={location} onChange={setLocation} placeholder="Staff entrance" />
      </FormGrid>
    </FormDialog>
  );
}

function IssueCredentialDialog({
  employee,
  onClose,
  onDone,
}: {
  employee: CredentialEmployee;
  onClose: () => void;
  onDone: () => void;
}) {
  const [type, setType] = useState('PIN');
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');

  const isPin = type === 'PIN';

  const mutation = useMutation({
    mutationFn: () =>
      post('/attendance/credentials', {
        employeeId: employee.id,
        type,
        identifier: isPin ? employee.employeeCode : identifier.trim(),
        ...(isPin ? { pin } : {}),
      }),
    onSuccess: onDone,
  });

  return (
    <FormDialog
      title={`Issue to ${employee.name}`}
      subtitle={employee.employeeCode}
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={isPin ? !/^\d{4,6}$/.test(pin) : identifier.trim() === ''}
      submitLabel="Issue"
    >
      <SelectField
        label="Type"
        value={type}
        onChange={(v) => {
          setType(v);
          setIdentifier('');
          setPin('');
        }}
        options={CREDENTIAL_TYPES.filter((t) => t !== 'QR_TOKEN').map((t) => ({
          value: t,
          label: t === 'PIN' ? 'PIN' : t.replace(/_/g, ' ').toLowerCase(),
        }))}
      />

      {isPin ? (
        <TextField
          label="PIN"
          value={pin}
          onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))}
          required
          placeholder="4 to 6 digits"
          hint="Hashed the same way a password is. Nobody — including the partners — can read it back, so a forgotten PIN is reissued, not looked up."
        />
      ) : (
        <TextField
          label="Card / device identifier"
          value={identifier}
          onChange={setIdentifier}
          required
          placeholder="04:A3:9F:2B"
          hint="The UID the reader reports when the card is tapped"
        />
      )}
    </FormDialog>
  );
}

function RevokeDialog({
  credential,
  onClose,
  onDone,
}: {
  credential: { id: string; label: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () => post(`/attendance/credentials/${credential.id}/revoke`, { reason: reason.trim() }),
    onSuccess: onDone,
  });

  return (
    <FormDialog
      title="Revoke"
      subtitle={credential.label}
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={reason.trim().length < 3}
      submitLabel="Revoke"
    >
      <TextField
        label="Reason"
        value={reason}
        onChange={setReason}
        required
        autoFocus
        placeholder="Card lost on the bus"
        hint="Kept on the audit trail. Past punches made with this credential stay valid — revoking stops future ones, it does not erase history."
      />
    </FormDialog>
  );
}
