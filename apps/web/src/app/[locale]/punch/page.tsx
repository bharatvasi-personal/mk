'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, inputClass } from '@/components/ui';
import { StaffShell } from '@/components/staff-shell';
import { get, post } from '@/lib/api';
import { useDict } from '@/lib/dict';
import { useSession } from '@/lib/session';

interface TodayRow {
  employee: { id: string; name: string; employeeCode: string; roleType: string };
  status: string;
  firstInAt: string | null;
  lastOutAt: string | null;
  workedMinutes: number;
  isIn: boolean;
  needsReviewReason: string | null;
}

export default function PunchPage() {
  return (
    <StaffShell requires="attendance:punch:self" title="Attendance">
      <PunchBoard />
    </StaffShell>
  );
}

/**
 * The punch board.
 *
 * At launch this is the whole attendance rail: the manager taps a name on the shop
 * tablet, or a staff member scans the rotating wall QR on their own phone. No hardware,
 * working on day one, and it exercises the same `POST /attendance/punch` that an NFC
 * reader will use in phase 3 — so nothing here is throwaway.
 *
 * Location is attached when the browser offers it. It is advisory: a punch outside the
 * geofence is flagged for review, never rejected, because GPS drift in a dense market is
 * real and a helper who cannot clock in stops using the system by Thursday.
 */
function PunchBoard() {
  const dict = useDict();
  const { branchId, can } = useSession();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const today = useQuery({
    queryKey: ['attendance-today', branchId],
    enabled: !!branchId && can('attendance:read:all'),
    refetchInterval: 60_000,
    queryFn: () => get<TodayRow[]>(`/attendance/today/${branchId}`),
  });

  async function punch(employeeId: string, direction: 'IN' | 'OUT') {
    setBusyId(employeeId);
    setError(null);
    setMessage(null);
    try {
      const position = await currentPosition();
      const res = await post<{ day: { status: string; workedMinutes: number }; employee: { name: string } }>(
        '/attendance/punch',
        {
          branchId,
          employeeId,
          direction,
          source: position ? 'MOBILE_GEO' : 'MANUAL',
          pin: pin || undefined,
          lat: position?.lat,
          lng: position?.lng,
          accuracyM: position?.accuracy,
        },
      );
      setMessage(
        `${res.employee.name}: ${direction === 'IN' ? dict.attendance.punchedIn : dict.attendance.punchedOut} · ${res.day.workedMinutes} min`,
      );
      setPin('');
      await today.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusyId(null);
    }
  }

  if (!can('attendance:read:all')) {
    return <SelfPunch onPunch={punch} busy={!!busyId} error={error} message={message} pin={pin} setPin={setPin} />;
  }

  return (
    <div className="space-y-4">
      <QrPanel />
      <ErrorNote error={error} />
      {message ? (
        <p className="rounded-lg border border-leaf-500 bg-leaf-100 px-3 py-2 text-sm text-leaf-600">{message}</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(today.data ?? []).map((row) => (
          <Card key={row.employee.id}>
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium">{row.employee.name}</div>
                <div className="text-xs text-ink-400">
                  {row.employee.employeeCode} · {row.employee.roleType}
                </div>
              </div>
              <StatusBadge status={row.status} />
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs text-ink-400">{dict.attendance.punchIn}</dt>
                <dd className="tabular-nums">{row.firstInAt ? timeOf(row.firstInAt) : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-400">{dict.attendance.punchOut}</dt>
                <dd className="tabular-nums">{row.lastOutAt ? timeOf(row.lastOutAt) : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-400">{dict.attendance.hoursWorked}</dt>
                <dd className="tabular-nums">{(row.workedMinutes / 60).toFixed(1)}h</dd>
              </div>
            </dl>

            {row.needsReviewReason ? (
              <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{row.needsReviewReason}</p>
            ) : null}

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                variant={row.isIn ? 'secondary' : 'leaf'}
                disabled={busyId === row.employee.id || row.isIn}
                onClick={() => void punch(row.employee.id, 'IN')}
              >
                {dict.attendance.punchIn}
              </Button>
              <Button
                variant={row.isIn ? 'primary' : 'secondary'}
                disabled={busyId === row.employee.id || !row.isIn}
                onClick={() => void punch(row.employee.id, 'OUT')}
              >
                {dict.attendance.punchOut}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SelfPunch({
  onPunch,
  busy,
  error,
  message,
  pin,
  setPin,
}: {
  onPunch: (employeeId: string, direction: 'IN' | 'OUT') => Promise<void>;
  busy: boolean;
  error: unknown;
  message: string | null;
  pin: string;
  setPin: (v: string) => void;
}) {
  const dict = useDict();
  const { session } = useSession();
  const staff = session?.kind === 'STAFF' ? session : null;
  const employeeId = staff?.employee?.id;

  if (!staff || !employeeId) {
    return (
      <Card>
        <p className="text-ink-600">
          Your login is not linked to an employee record yet — ask the manager to link it before you punch in.
        </p>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-sm">
      <h2 className="font-display text-lg font-semibold">{staff.name}</h2>
      <Field label={dict.attendance.enterPin}>
        <input
          className={`${inputClass} text-center text-2xl tracking-[0.4em]`}
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
      </Field>
      <ErrorNote error={error} />
      {message ? <p className="mt-2 text-sm text-leaf-600">{message}</p> : null}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="leaf" size="lg" disabled={busy} onClick={() => void onPunch(employeeId, 'IN')}>
          {dict.attendance.punchIn}
        </Button>
        <Button size="lg" disabled={busy} onClick={() => void onPunch(employeeId, 'OUT')}>
          {dict.attendance.punchOut}
        </Button>
      </div>
    </Card>
  );
}

/**
 * The wall QR. The token rotates every 90 seconds so photographing it once does not let
 * someone punch in from home — the cheap mitigation for the one real weakness of a
 * shared-device punch.
 */
function QrPanel() {
  const dict = useDict();
  const { branchId } = useSession();
  const [visible, setVisible] = useState(false);

  const token = useQuery({
    queryKey: ['punch-qr', branchId],
    enabled: !!branchId && visible,
    refetchInterval: 60_000,
    queryFn: () => get<{ token: string; expiresInSeconds: number }>(`/attendance/qr/${branchId}`),
  });

  const url =
    typeof window !== 'undefined' && token.data
      ? `${window.location.origin}/en/punch?token=${token.data.token}&branch=${branchId}`
      : '';

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">{dict.attendance.scanQr}</h2>
          <p className="text-sm text-ink-400">Rotates every 90 seconds</p>
        </div>
        <Button variant="secondary" onClick={() => setVisible((v) => !v)}>
          {visible ? dict.common.close : dict.common.add}
        </Button>
      </div>
      {visible && url ? (
        <div className="mt-3 flex flex-col items-center gap-2">
          {/* Rendered by a QR service-free SVG generator would need a dependency; the
              URL is shown verbatim so it can be typed or copied while the QR component
              is added in phase 2. */}
          <code className="break-all rounded bg-ink-100 px-2 py-1 text-xs">{url}</code>
          <span className="text-xs text-ink-400">Expires in {token.data?.expiresInSeconds ?? 90}s</span>
        </div>
      ) : null}
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const dict = useDict();
  const map: Record<string, { tone: 'good' | 'bad' | 'warn' | 'neutral'; label: string }> = {
    PRESENT: { tone: 'good', label: dict.attendance.present },
    ABSENT: { tone: 'bad', label: dict.attendance.absent },
    HALF_DAY: { tone: 'warn', label: dict.attendance.halfDay },
    WEEKLY_OFF: { tone: 'neutral', label: dict.attendance.weeklyOff },
    HOLIDAY: { tone: 'neutral', label: dict.attendance.holiday },
    LEAVE: { tone: 'neutral', label: dict.attendance.leave },
    NEEDS_REVIEW: { tone: 'warn', label: dict.attendance.needsReview },
  };
  const entry = map[status] ?? { tone: 'neutral' as const, label: status };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
}

/** Location is best-effort: a denied or slow fix must not block the punch. */
function currentPosition(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { timeout: 4000, maximumAge: 60_000 },
    );
  });
}
