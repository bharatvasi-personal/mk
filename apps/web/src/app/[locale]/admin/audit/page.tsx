'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, Empty, ErrorNote, Table } from '@/components/ui';
import { SelectField, TextField, Toolbar } from '@/components/admin/form';
import { StaffShell } from '@/components/staff-shell';
import { get } from '@/lib/api';
import { useSession } from '@/lib/session';

interface AuditRow {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorLabel: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  requestId: string | null;
  branchId: string | null;
  createdAt: string;
  user: { name: string; email: string | null } | null;
}

interface AuditPage {
  total: number;
  page: number;
  pageSize: number;
  rows: AuditRow[];
  actions: string[];
  entities: string[];
}

export default function AuditPage() {
  return (
    <StaffShell requires="audit:read" title="Audit trail">
      <Audit />
    </StaffShell>
  );
}

/**
 * Who did what, and when.
 *
 * A partnership is three people who trust each other and still need to be able to check.
 * Nobody opens this screen wanting "recent activity" — they arrive holding a question:
 * who voided that ₹300 bill on Tuesday, who moved the thali to ₹99, who downloaded the
 * FSSAI licence. So the filters are a date range, an action and a person, and the diff is
 * on the row rather than behind a click.
 *
 * Nothing here can be edited or deleted: audit_logs carries an append-only trigger in the
 * database, so even a compromised application account cannot rewrite it.
 */
function Audit() {
  const { branchId } = useSession();
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [thisBranchOnly, setThisBranchOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['audit', from, to, action, entity, thisBranchOnly, branchId, page],
    queryFn: () =>
      get<AuditPage>(
        `/reports/audit?${new URLSearchParams({
          from,
          to,
          ...(action ? { action } : {}),
          ...(entity ? { entity } : {}),
          ...(thisBranchOnly && branchId ? { branchId } : {}),
          page: String(page),
        })}`,
      ),
  });

  const data = query.data;
  const rows = data?.rows ?? [];
  const pages = Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 50));

  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <div className="space-y-3">
      <Toolbar>
        <TextField label="From" value={from} onChange={reset(setFrom)} type="date" />
        <TextField label="To" value={to} onChange={reset(setTo)} type="date" />
        <SelectField
          label="Action"
          value={action}
          onChange={reset(setAction)}
          placeholder="Any"
          options={(data?.actions ?? []).map((a) => ({ value: a, label: a.replace(/_/g, ' ').toLowerCase() }))}
        />
        <SelectField
          label="Record type"
          value={entity}
          onChange={reset(setEntity)}
          placeholder="Any"
          options={(data?.entities ?? []).map((e) => ({ value: e, label: e }))}
        />
        <div className="ml-auto self-end">
          <Button
            variant={thisBranchOnly ? 'primary' : 'secondary'}
            onClick={() => {
              setThisBranchOnly((v) => !v);
              setPage(1);
            }}
          >
            {thisBranchOnly ? 'This branch only' : 'All branches'}
          </Button>
        </div>
      </Toolbar>

      <p className="text-sm text-ink-600">
        {data?.total ?? 0} events. Entries are append-only — the database refuses updates and deletes on this
        table, so what is here is what happened.
      </p>

      <ErrorNote error={query.error} />

      {rows.length === 0 ? (
        <Empty>No events match those filters.</Empty>
      ) : (
        <Table head={['When', 'Who', 'Did what', 'To what', '']}>
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="px-3 py-2">
                <div className="tabular-nums">
                  {new Date(r.createdAt).toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    dateStyle: 'short',
                    timeStyle: 'medium',
                  })}
                </div>
                {r.ip ? <div className="text-xs text-ink-400">{r.ip}</div> : null}
              </td>
              <td className="px-3 py-2">
                <div className="text-sm font-medium">{r.user?.name ?? r.actorLabel ?? 'System'}</div>
                {r.user?.email ? <div className="text-xs text-ink-400">{r.user.email}</div> : null}
              </td>
              <td className="px-3 py-2">
                <Badge tone={toneFor(r.action)}>{r.action.replace(/_/g, ' ').toLowerCase()}</Badge>
              </td>
              <td className="px-3 py-2">
                <div className="text-sm">{r.entity}</div>
                {r.entityId ? (
                  <div className="font-mono text-[11px] text-ink-400">{r.entityId.slice(0, 8)}…</div>
                ) : null}
              </td>
              <td className="px-3 py-2">
                {r.before || r.after ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>
                      {open === r.id ? 'Hide' : 'What changed'}
                    </Button>
                    {open === r.id ? (
                      <Card className="mt-2 !bg-ink-50 !p-3">
                        <Diff before={r.before} after={r.after} />
                        {r.requestId ? (
                          <p className="mt-2 font-mono text-[11px] text-ink-400">request {r.requestId}</p>
                        ) : null}
                      </Card>
                    ) : null}
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Newer
          </Button>
          <span className="text-sm text-ink-600">
            {page} of {pages}
          </span>
          <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Older →
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Field-level diff.
 *
 * "What changed" is the only question worth asking of an audit row, and a raw JSON blob
 * answers it badly — the eye has to compare two objects by hand. This lists only the keys
 * whose value actually moved.
 */
function Diff({ before, after }: { before: unknown; after: unknown }) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(
    (k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]),
  );

  if (keys.length === 0) {
    return <pre className="overflow-x-auto text-xs text-ink-600">{JSON.stringify(after ?? before, null, 2)}</pre>;
  }

  return (
    <dl className="space-y-1.5 text-xs">
      {keys.map((k) => (
        <div key={k} className="grid grid-cols-[8rem_1fr] gap-2">
          <dt className="font-medium text-ink-600">{k}</dt>
          <dd className="break-all">
            {k in b ? <s className="text-red-600">{show(b[k])}</s> : null}
            {k in b && k in a ? ' → ' : null}
            {k in a ? <span className="text-leaf-600">{show(a[k])}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function show(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function toneFor(action: string): 'neutral' | 'good' | 'warn' | 'bad' | 'brand' {
  if (/DELETE|VOID|CANCEL|REVOKE|FAIL/.test(action)) return 'bad';
  if (/APPROVE|SETTLE|PAID|CREATE/.test(action)) return 'good';
  if (/DOWNLOAD|LOGIN|EXPORT/.test(action)) return 'warn';
  return 'neutral';
}
