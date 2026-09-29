'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  LEGAL_DOCUMENT_CATEGORIES,
  LEGAL_DOCUMENT_GROUPS,
  groupForDocumentCategory,
  type LegalDocumentGroupKey,
} from '@mk/shared';
import { Badge, Button, Card, Empty, ErrorNote, Table } from '@/components/ui';
import {
  CheckField,
  FormDialog,
  FormGrid,
  FormSection,
  FullWidth,
  MoneyField,
  NumberField,
  SelectField,
  TextField,
  Toolbar,
} from '@/components/admin/form';
import { StaffShell } from '@/components/staff-shell';
import { api, get, post } from '@/lib/api';
import { useDict } from '@/lib/dict';
import { useSession } from '@/lib/session';

interface Doc {
  id: string;
  category: string;
  title: string;
  documentNumber: string | null;
  issuingAuthority: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  renewalLeadDays: number;
  renewalFeeMinor: number | null;
  fileName: string;
  fileSizeBytes: number;
  daysToExpiry: number | null;
  status: 'NO_EXPIRY' | 'EXPIRED' | 'EXPIRING_SOON' | 'VALID';
  isRenewable: boolean;
  branch: { id: string; name: string } | null;
  employee: { id: string; name: string } | null;
}

export default function LegalPage() {
  return (
    <StaffShell requires="legal:read" title="Documents">
      <Legal />
    </StaffShell>
  );
}

/**
 * The document vault, filed the way the people using it think about paperwork.
 *
 * A flat list of fifteen categories is a cabinet with no drawers. The licences that can
 * close the shop are not the same kind of thing as a staff contract, so they get their
 * own section at the top with the renewal clock on every card.
 */
function Legal() {
  const dict = useDict();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<LegalDocumentGroupKey | 'ALL'>('ALL');

  const docs = useQuery({ queryKey: ['legal-docs'], queryFn: () => get<Doc[]>('/legal/documents') });
  const compliance = useQuery({
    queryKey: ['compliance'],
    queryFn: () => get<{ missing: string[]; expired: Doc[]; expiringSoon: Doc[] }>('/legal/compliance'),
  });

  const grouped = useMemo(() => {
    const map = new Map<LegalDocumentGroupKey, Doc[]>();
    for (const d of docs.data ?? []) {
      const key = groupForDocumentCategory(d.category);
      map.set(key, [...(map.get(key) ?? []), d]);
    }
    return map;
  }, [docs.data]);

  async function download(id: string) {
    const res = await api<{ url: string }>(`/legal/documents/${id}/download`);
    window.open(res.url, '_blank', 'noopener');
  }

  const attention = [...(compliance.data?.expired ?? []), ...(compliance.data?.expiringSoon ?? [])];

  return (
    <div className="space-y-4">
      {attention.length > 0 ? (
        <Card className="!border-red-300 !bg-red-50">
          <h2 className="font-medium text-red-800">Needs attention now</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {attention.map((d) => (
              <li key={d.id} className="flex items-baseline justify-between gap-2">
                <span>{d.title}</span>
                <Badge tone={d.daysToExpiry !== null && d.daysToExpiry < 0 ? 'bad' : 'warn'}>
                  {d.daysToExpiry === null
                    ? '—'
                    : d.daysToExpiry < 0
                      ? `expired ${-d.daysToExpiry}d ago`
                      : `${d.daysToExpiry}d left`}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {(compliance.data?.missing.length ?? 0) > 0 ? (
        <Card className="!border-amber-300 !bg-amber-50">
          <h2 className="font-medium text-amber-900">Not on file yet</h2>
          <p className="mt-1 text-sm text-amber-800">
            Expected for a food business in Telangana. A document you simply do not have is a risk no
            expiry-date report can surface.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {compliance.data!.missing.map((m) => (
              <button
                key={m}
                onClick={() => can('legal:write') && setUploading(m)}
                className="rounded-full bg-amber-200 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-300"
              >
                + {m.replace(/_/g, ' ').toLowerCase()}
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      <Toolbar>
        {can('legal:write') ? <Button onClick={() => setUploading('')}>+ Upload a document</Button> : null}
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setOpenGroup('ALL')}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              openGroup === 'ALL' ? 'bg-ink-800 text-white' : 'border border-ink-200 bg-white text-ink-600'
            }`}
          >
            {dict.common.all}
          </button>
          {LEGAL_DOCUMENT_GROUPS.map((g) => (
            <button
              key={g.key}
              onClick={() => setOpenGroup(g.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                openGroup === g.key ? 'bg-ink-800 text-white' : 'border border-ink-200 bg-white text-ink-600'
              }`}
            >
              {g.label}
              <span className="ml-1 opacity-60">{grouped.get(g.key)?.length ?? 0}</span>
            </button>
          ))}
        </div>
      </Toolbar>

      <ErrorNote error={docs.error} />

      {(docs.data?.length ?? 0) === 0 ? (
        <Empty>
          The vault is empty. Start with the partnership deed, the FSSAI registration and the trade licence —
          with their real expiry dates, so the reminders have something to fire on.
        </Empty>
      ) : (
        LEGAL_DOCUMENT_GROUPS.filter((g) => openGroup === 'ALL' || openGroup === g.key).map((group) => {
          const rows = grouped.get(group.key) ?? [];
          return (
            <Card key={group.key}>
              <div className="mb-2">
                <h2 className="font-display text-lg font-semibold text-brand-800">{group.label}</h2>
                <p className="text-sm text-ink-600">{group.blurb}</p>
              </div>

              {rows.length === 0 ? (
                <p className="py-4 text-sm text-ink-400">Nothing filed here yet.</p>
              ) : (
                <Table
                  head={[
                    'Document',
                    'Belongs to',
                    'Number',
                    'Expires',
                    dict.common.status,
                    ...(can('legal:download') ? [dict.common.actions] : []),
                  ]}
                >
                  {rows.map((d) => (
                    <tr
                      key={d.id}
                      className={
                        d.status === 'EXPIRED' ? 'bg-red-50' : d.status === 'EXPIRING_SOON' ? 'bg-amber-50' : undefined
                      }
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{d.title}</div>
                        <div className="text-xs text-ink-400">
                          {d.category.replace(/_/g, ' ').toLowerCase()} · {(d.fileSizeBytes / 1024).toFixed(0)} KB
                        </div>
                      </td>
                      <td className="px-3 py-2 text-ink-600">
                        {d.employee ? d.employee.name : d.branch ? d.branch.name : 'The whole business'}
                      </td>
                      <td className="px-3 py-2">{d.documentNumber ?? '—'}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {d.expiresOn ? d.expiresOn.slice(0, 10) : '—'}
                        {d.daysToExpiry !== null ? (
                          <div className="text-xs text-ink-400">
                            {d.daysToExpiry < 0 ? `${-d.daysToExpiry}d ago` : `in ${d.daysToExpiry}d`}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          tone={
                            d.status === 'EXPIRED'
                              ? 'bad'
                              : d.status === 'EXPIRING_SOON'
                                ? 'warn'
                                : d.status === 'VALID'
                                  ? 'good'
                                  : 'neutral'
                          }
                        >
                          {d.status === 'NO_EXPIRY'
                            ? 'no expiry'
                            : d.status === 'EXPIRED'
                              ? 'expired'
                              : d.status === 'EXPIRING_SOON'
                                ? 'renew soon'
                                : 'valid'}
                        </Badge>
                      </td>
                      {can('legal:download') ? (
                        <td className="px-3 py-2">
                          <Button size="sm" variant="secondary" onClick={() => void download(d.id)}>
                            {dict.legal.download}
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          );
        })
      )}

      {uploading !== null ? (
        <UploadDialog
          presetCategory={uploading}
          onClose={() => setUploading(null)}
          onDone={() => {
            setUploading(null);
            void queryClient.invalidateQueries({ queryKey: ['legal-docs'] });
            void queryClient.invalidateQueries({ queryKey: ['compliance'] });
          }}
        />
      ) : null}
    </div>
  );
}

function UploadDialog({
  presetCategory,
  onClose,
  onDone,
}: {
  presetCategory: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { branchId } = useSession();
  const employees = useQuery({
    queryKey: ['employees', branchId],
    enabled: !!branchId,
    queryFn: () => get<{ id: string; name: string; employeeCode: string }[]>(`/staff/employees?branchId=${branchId}`),
  });

  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    category: presetCategory || 'FSSAI_REGISTRATION',
    title: '',
    documentNumber: '',
    issuingAuthority: '',
    issuedOn: '',
    expiresOn: '',
    renewalLeadDays: '60',
    belongsTo: presetCategory === 'STAFF_CONTRACT' ? 'EMPLOYEE' : 'BUSINESS',
    employeeId: '',
  });
  const [renewalFee, setRenewalFee] = useState(0);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const group = LEGAL_DOCUMENT_GROUPS.find((g) =>
    (g.categories as readonly string[]).includes(form.category),
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a file');

      const presigned = await post<{ key: string; uploadUrl: string }>('/legal/upload-url', {
        fileName: file.name,
        mimeType: file.type || 'application/pdf',
      });

      const put = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/pdf' },
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status}). Check object storage is reachable.`);

      return post('/legal/documents', {
        branchId: form.belongsTo === 'BRANCH' ? branchId : null,
        employeeId: form.belongsTo === 'EMPLOYEE' ? form.employeeId : null,
        category: form.category,
        title: form.title || file.name,
        documentNumber: form.documentNumber || undefined,
        issuingAuthority: form.issuingAuthority || undefined,
        issuedOn: form.issuedOn || undefined,
        expiresOn: form.expiresOn || undefined,
        renewalLeadDays: Number(form.renewalLeadDays) || 60,
        renewalFeeMinor: renewalFee || undefined,
        tags: [],
        fileKey: presigned.key,
        fileName: file.name,
        mimeType: file.type || 'application/pdf',
        fileSizeBytes: file.size,
      });
    },
    onSuccess: onDone,
  });

  return (
    <FormDialog
      title="Upload a document"
      subtitle={group ? `${group.label} — ${group.blurb}` : undefined}
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={!file}
      submitLabel="Upload"
      wide
    >
      <FullWidth>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-800">File *</span>
          <input
            className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-brand-100 file:px-3 file:py-1.5 file:text-brand-800"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.docx"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !form.title) set('title', f.name.replace(/\.[^.]+$/, ''));
            }}
          />
          <span className="mt-1 block text-xs text-ink-400">PDF, JPEG, PNG, WebP or DOCX, up to 25 MB</span>
        </label>
      </FullWidth>

      <FormGrid>
        <SelectField
          label="What is it"
          value={form.category}
          onChange={(v) => set('category', v)}
          options={LEGAL_DOCUMENT_GROUPS.flatMap((g) =>
            g.categories.map((c) => ({ value: c, label: `${g.label} › ${c.replace(/_/g, ' ').toLowerCase()}` })),
          ).concat(
            LEGAL_DOCUMENT_CATEGORIES.filter(
              (c) => !LEGAL_DOCUMENT_GROUPS.some((g) => (g.categories as readonly string[]).includes(c)),
            ).map((c) => ({ value: c, label: c.replace(/_/g, ' ').toLowerCase() })),
          )}
          required
        />
        <TextField label="Title" value={form.title} onChange={(v) => set('title', v)} required />

        <SelectField
          label="Belongs to"
          value={form.belongsTo}
          onChange={(v) => set('belongsTo', v)}
          options={[
            { value: 'BUSINESS', label: 'The whole business' },
            { value: 'BRANCH', label: 'This branch only' },
            { value: 'EMPLOYEE', label: 'A member of staff' },
          ]}
          hint="A partnership deed is the business; a trade licence is a branch; a contract is a person."
        />
        {form.belongsTo === 'EMPLOYEE' ? (
          <SelectField
            label="Which person"
            value={form.employeeId}
            onChange={(v) => set('employeeId', v)}
            placeholder="Choose…"
            options={(employees.data ?? []).map((e) => ({ value: e.id, label: `${e.name} (${e.employeeCode})` }))}
          />
        ) : (
          <div />
        )}

        <TextField label="Document number" value={form.documentNumber} onChange={(v) => set('documentNumber', v)} />
        <TextField label="Issued by" value={form.issuingAuthority} onChange={(v) => set('issuingAuthority', v)} placeholder="FSSAI, GHMC…" />
      </FormGrid>

      <FormSection title="Renewal" hint="Leave the expiry blank for a deed or a PAN — those do not expire.">
        <FormGrid>
          <TextField label="Issued on" value={form.issuedOn} onChange={(v) => set('issuedOn', v)} type="date" />
          <TextField label="Expires on" value={form.expiresOn} onChange={(v) => set('expiresOn', v)} type="date" />
          <NumberField
            label="Start reminding"
            value={form.renewalLeadDays}
            onChange={(v) => set('renewalLeadDays', v)}
            min={1}
            max={365}
            suffix="days before"
            hint="Then again at 30, 14, 7, 3, 1 and on the day"
          />
          <MoneyField label="Renewal fee" minor={renewalFee} onChange={setRenewalFee} hint="So it can be budgeted" />
        </FormGrid>
      </FormSection>
    </FormDialog>
  );
}
