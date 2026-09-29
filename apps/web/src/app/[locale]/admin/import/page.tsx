'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Badge, Button, Card, Empty, ErrorNote, Table } from '@/components/ui';
import { StaffShell } from '@/components/staff-shell';
import { api, post } from '@/lib/api';
import { API_URL, DEFAULT_TENANT } from '@/lib/config';
import { useDict } from '@/lib/dict';
import { useSession } from '@/lib/session';

type Entity = 'inventory' | 'menu' | 'vendors' | 'employees';

interface EntitySpec {
  entity: Entity;
  permission: string;
  required: string[];
  columns: { name: string; description: string; example: string }[];
}

interface RowResult {
  line: number;
  action: 'CREATE' | 'UPDATE' | 'SKIP';
  label: string;
  errors: string[];
  warnings: string[];
}

interface Preview {
  entity: Entity;
  totalRows: number;
  createCount: number;
  updateCount: number;
  errorCount: number;
  unknownHeaders: string[];
  missingHeaders: string[];
  rows: RowResult[];
}

const LABELS: Record<Entity, string> = {
  inventory: 'Inventory items',
  menu: 'Menu & prices',
  vendors: 'Vendors',
  employees: 'Staff',
};

export default function ImportPage() {
  return (
    <StaffShell requires="inventory:read" title="Import data">
      <Importer />
    </StaffShell>
  );
}

/**
 * Bulk import from a spreadsheet.
 *
 * Two steps on purpose: upload and see exactly what will happen, then commit. The file
 * is validated in full before anything changes, so a fifty-row file with three mistakes
 * reports all three at once rather than one per attempt.
 *
 * The commit is all-or-nothing. A half-imported menu is worse than an empty one, because
 * nobody can tell which half arrived.
 */
function Importer() {
  const dict = useDict();
  const { branchId, can } = useSession();
  const fileInput = useRef<HTMLInputElement>(null);
  const [entity, setEntity] = useState<Entity>('inventory');
  const [csv, setCsv] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [committed, setCommitted] = useState<Preview | null>(null);

  const specs = useQuery({
    queryKey: ['import-entities'],
    queryFn: () => api<EntitySpec[]>('/import/entities'),
  });

  const spec = specs.data?.find((s) => s.entity === entity);
  const allowed = spec ? can(spec.permission as never) : true;

  const previewMutation = useMutation({
    mutationFn: () => post<Preview>(`/import/${entity}/preview`, { branchId, csv }),
    onSuccess: (result) => {
      setPreview(result);
      setCommitted(null);
    },
  });

  const commitMutation = useMutation({
    mutationFn: () => post<Preview>(`/import/${entity}/commit`, { branchId, csv }),
    onSuccess: (result) => {
      setCommitted(result);
      setPreview(null);
      setCsv('');
      setFileName('');
      if (fileInput.current) fileInput.current.value = '';
    },
  });

  function reset() {
    setCsv('');
    setFileName('');
    setPreview(null);
    setCommitted(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    setCommitted(null);
    // Read in the browser and send the text. The API parses it with the same code the
    // preview would use, so what is shown and what is applied cannot disagree.
    setCsv(await file.text());
  }

  /**
   * The template is fetched rather than linked, because the API needs an Authorization
   * header and a plain `<a href>` cannot carry one.
   */
  async function downloadTemplate() {
    const res = await fetch(`${API_URL}/api/import/${entity}/template`, {
      headers: { 'X-Tenant': DEFAULT_TENANT, Authorization: `Bearer ${await bearer()}` },
      credentials: 'include',
    });
    const text = await res.text();
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `mithilakitchen-${entity}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-medium">What are you importing?</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          {(Object.keys(LABELS) as Entity[]).map((e) => (
            <button
              key={e}
              onClick={() => {
                setEntity(e);
                reset();
              }}
              className={`pos-tap rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                entity === e ? 'bg-brand-600 text-white' : 'border border-ink-200 bg-white text-ink-600'
              }`}
            >
              {LABELS[e]}
            </button>
          ))}
        </div>

        {!allowed ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {dict.auth.noAccess} — importing {LABELS[entity].toLowerCase()} needs{' '}
            <code>{spec?.permission}</code>.
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => void downloadTemplate()}>
            Download template
          </Button>
          <span className="text-sm text-ink-400">
            Fill it in, save as CSV, and upload it below. Existing rows are updated, not duplicated.
          </span>
        </div>

        <div className="mt-4">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            disabled={!allowed}
            onChange={(e) => void onFile(e.target.files?.[0])}
            className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-brand-100 file:px-3 file:py-1.5 file:text-brand-800"
          />
        </div>

        {csv ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{fileName}</Badge>
            <Button disabled={previewMutation.isPending} onClick={() => previewMutation.mutate()}>
              {previewMutation.isPending ? dict.common.loading : 'Check the file'}
            </Button>
            <Button variant="ghost" onClick={reset}>
              {dict.common.cancel}
            </Button>
          </div>
        ) : null}

        <ErrorNote error={previewMutation.error} />
        <ErrorNote error={commitMutation.error} />
      </Card>

      {committed ? (
        <Card className="!border-leaf-500 !bg-leaf-100">
          <h2 className="font-display text-lg font-semibold text-leaf-600">Imported</h2>
          <p className="mt-1 text-ink-800">
            {committed.createCount} created, {committed.updateCount} updated.
          </p>
        </Card>
      ) : null}

      {preview ? <PreviewPanel preview={preview} onCommit={() => commitMutation.mutate()} busy={commitMutation.isPending} /> : null}

      {spec ? (
        <Card>
          <h2 className="font-medium">Columns for {LABELS[entity].toLowerCase()}</h2>
          <p className="mt-1 text-sm text-ink-600">
            Column names are matched loosely — <code>Reorder Point</code>, <code>reorder_point</code> and{' '}
            <code>reorderPoint</code> all work. Anything not listed here is ignored.
          </p>
          <Table head={['Column', 'Required', 'What it is', 'Example']}>
            {spec.columns.map((c) => (
              <tr key={c.name}>
                <td className="px-3 py-2 font-mono text-xs">{c.name}</td>
                <td className="px-3 py-2">
                  {spec.required.includes(c.name) ? <Badge tone="brand">required</Badge> : <span className="text-ink-400">—</span>}
                </td>
                <td className="px-3 py-2 text-ink-600">{c.description}</td>
                <td className="px-3 py-2 font-mono text-xs text-ink-400">{c.example}</td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
    </div>
  );
}

function PreviewPanel({
  preview,
  onCommit,
  busy,
}: {
  preview: Preview;
  onCommit: () => void;
  busy: boolean;
}) {
  const dict = useDict();
  const blocked = preview.errorCount > 0 || preview.missingHeaders.length > 0;
  const withIssues = preview.rows.filter((r) => r.errors.length > 0 || r.warnings.length > 0);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">What will happen</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge tone="good">{preview.createCount} new</Badge>
          <Badge tone="brand">{preview.updateCount} updated</Badge>
          {preview.errorCount > 0 ? <Badge tone="bad">{preview.errorCount} with errors</Badge> : null}
        </div>
      </div>

      {preview.missingHeaders.length > 0 ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          The file is missing required columns: <strong>{preview.missingHeaders.join(', ')}</strong>. Download
          the template and copy your data into it.
        </p>
      ) : null}

      {preview.unknownHeaders.length > 0 ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Ignoring columns this importer does not use: {preview.unknownHeaders.join(', ')}.
        </p>
      ) : null}

      {preview.totalRows === 0 ? (
        <Empty>That file has no data rows.</Empty>
      ) : (
        <>
          {withIssues.length > 0 ? (
            <Table head={['Line', 'Row', 'Problem']}>
              {withIssues.map((r) => (
                <tr key={r.line} className={r.errors.length > 0 ? 'bg-red-50' : 'bg-amber-50'}>
                  <td className="px-3 py-2 tabular-nums">{r.line}</td>
                  <td className="px-3 py-2">{r.label}</td>
                  <td className="px-3 py-2">
                    {r.errors.map((e) => (
                      <div key={e} className="text-red-700">
                        {e}
                      </div>
                    ))}
                    {r.warnings.map((w) => (
                      <div key={w} className="text-amber-800">
                        {w}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="mt-3 rounded-lg bg-leaf-100 px-3 py-2 text-sm text-leaf-600">
              All {preview.totalRows} rows look good.
            </p>
          )}

          <div className="mt-4 flex items-center gap-3">
            <Button size="lg" disabled={blocked || busy} onClick={onCommit}>
              {busy ? dict.common.saving : `Import ${preview.totalRows} rows`}
            </Button>
            {blocked ? (
              <span className="text-sm text-ink-600">
                Fix the errors above and upload again. Nothing has been changed.
              </span>
            ) : null}
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * The in-memory access token, reached without exporting it from the API client — the
 * token deliberately never leaves that module, and this is the one place a raw `fetch`
 * needs it (a download cannot go through the usual JSON path).
 */
async function bearer(): Promise<string> {
  const { getAccessToken } = await import('@/lib/api');
  return getAccessToken() ?? '';
}
