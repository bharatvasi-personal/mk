'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { LEGAL_DOCUMENT_CATEGORIES } from '@mk/shared';
import { Badge, Button, Card, Empty, ErrorNote, Field, Table, inputClass } from '@/components/ui';
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
  fileName: string;
  fileSizeBytes: number;
  daysToExpiry: number | null;
  status: 'NO_EXPIRY' | 'EXPIRED' | 'EXPIRING_SOON' | 'VALID';
  isRenewable: boolean;
  branch: { id: string; name: string } | null;
}

export default function LegalPage() {
  return (
    <StaffShell requires="legal:read" title="Documents">
      <Legal />
    </StaffShell>
  );
}

/**
 * The document vault.
 *
 * The failure mode this exists to prevent is a sealed shop: FSSAI, the trade licence and
 * the shop & establishment registration are annual renewals, and nobody remembers them
 * in month eleven. Reminders escalate at 60/30/14/7/3/1 days and on expiry.
 *
 * Files never pass through the API — the browser uploads straight to object storage with
 * a presigned URL, and downloading is a separate, logged, five-minute link.
 */
function Legal() {
  const dict = useDict();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);

  const docs = useQuery({ queryKey: ['legal-docs'], queryFn: () => get<Doc[]>('/legal/documents') });
  const compliance = useQuery({
    queryKey: ['compliance'],
    queryFn: () => get<{ missing: string[] }>('/legal/compliance'),
  });

  async function download(id: string) {
    const res = await api<{ url: string; fileName: string }>(`/legal/documents/${id}/download`);
    window.open(res.url, '_blank', 'noopener');
  }

  return (
    <div className="space-y-4">
      {(compliance.data?.missing.length ?? 0) > 0 ? (
        <Card className="!border-amber-300 !bg-amber-50">
          <h2 className="font-medium text-amber-900">Not on file yet</h2>
          <p className="mt-1 text-sm text-amber-800">
            These are expected for a food business in Telangana. An absent document is a risk no expiry-date
            report can surface.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {compliance.data!.missing.map((m) => (
              <Badge key={m} tone="warn">
                {m.replace(/_/g, ' ').toLowerCase()}
              </Badge>
            ))}
          </div>
        </Card>
      ) : null}

      {can('legal:write') ? (
        <div>
          <Button onClick={() => setUploading(true)}>{dict.legal.upload}</Button>
        </div>
      ) : null}

      <ErrorNote error={docs.error} />

      {(docs.data?.length ?? 0) === 0 ? (
        <Empty>
          The vault is empty. Upload the partnership deed, FSSAI registration and trade licence with their real
          expiry dates so the reminders have something to fire on.
        </Empty>
      ) : (
        <Table
          head={[
            dict.common.name,
            'Category',
            'Number',
            dict.legal.expiresOn,
            dict.common.status,
            ...(can('legal:download') ? [dict.common.actions] : []),
          ]}
        >
          {(docs.data ?? []).map((d) => (
            <tr key={d.id} className={d.status === 'EXPIRED' ? 'bg-red-50' : d.status === 'EXPIRING_SOON' ? 'bg-amber-50' : undefined}>
              <td className="px-3 py-2">
                <div className="font-medium">{d.title}</div>
                <div className="text-xs text-ink-400">
                  {d.fileName} · {(d.fileSizeBytes / 1024).toFixed(0)} KB
                  {d.branch ? ` · ${d.branch.name}` : ''}
                </div>
              </td>
              <td className="px-3 py-2 text-ink-600">{d.category.replace(/_/g, ' ').toLowerCase()}</td>
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
                    d.status === 'EXPIRED' ? 'bad' : d.status === 'EXPIRING_SOON' ? 'warn' : d.status === 'VALID' ? 'good' : 'neutral'
                  }
                >
                  {d.status === 'NO_EXPIRY'
                    ? dict.legal.noExpiry
                    : d.status === 'EXPIRED'
                      ? dict.legal.expired
                      : d.status === 'EXPIRING_SOON'
                        ? dict.legal.expiringSoon
                        : dict.legal.valid}
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

      {uploading ? (
        <UploadDialog
          onClose={() => setUploading(false)}
          onDone={() => {
            setUploading(false);
            void queryClient.invalidateQueries({ queryKey: ['legal-docs'] });
            void queryClient.invalidateQueries({ queryKey: ['compliance'] });
          }}
        />
      ) : null}
    </div>
  );
}

function UploadDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const dict = useDict();
  const { branchId } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<string>('FSSAI_REGISTRATION');
  const [title, setTitle] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [issuingAuthority, setIssuingAuthority] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [leadDays, setLeadDays] = useState(60);
  const [scopeBranch, setScopeBranch] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a file');

      // Step 1: a presigned PUT. The API never sees the bytes, so a 12 MB scan does not
      // occupy a Node process for the duration of the upload.
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

      // Step 2: the metadata. The API verifies the checksum of what actually landed
      // rather than trusting this client's word for it.
      return post('/legal/documents', {
        branchId: scopeBranch ? branchId : null,
        employeeId: null,
        category,
        title: title || file.name,
        documentNumber: documentNumber || undefined,
        issuingAuthority: issuingAuthority || undefined,
        issuedOn: issuedOn || undefined,
        expiresOn: expiresOn || undefined,
        renewalLeadDays: leadDays,
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
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-ink-900/50 p-4">
      <Card className="w-full max-w-lg">
        <h2 className="font-display text-lg font-semibold">{dict.legal.upload}</h2>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="File" hint="PDF, JPEG, PNG, WebP or DOCX, up to 25 MB">
              <input
                className={inputClass}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.docx"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
                }}
              />
            </Field>
          </div>

          <Field label="Category">
            <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
              {LEGAL_DOCUMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, ' ').toLowerCase()}
                </option>
              ))}
            </select>
          </Field>

          <Field label={dict.common.name}>
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>

          <Field label="Document number">
            <input className={inputClass} value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />
          </Field>

          <Field label="Issuing authority">
            <input className={inputClass} value={issuingAuthority} onChange={(e) => setIssuingAuthority(e.target.value)} />
          </Field>

          <Field label="Issued on">
            <input className={inputClass} type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
          </Field>

          <Field label={dict.legal.expiresOn} hint="Leave blank for a deed or a PAN — they do not expire">
            <input className={inputClass} type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </Field>

          <Field label="Remind from (days before)">
            <input
              className={inputClass}
              type="number"
              min={1}
              max={365}
              value={leadDays}
              onChange={(e) => setLeadDays(Number(e.target.value) || 60)}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={scopeBranch} onChange={(e) => setScopeBranch(e.target.checked)} />
            This document belongs to one branch (a trade licence), not the whole business (a deed)
          </label>
        </div>

        <ErrorNote error={mutation.error} />

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onClose}>
            {dict.common.cancel}
          </Button>
          <Button disabled={!file || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? dict.common.saving : dict.legal.upload}
          </Button>
        </div>
      </Card>
    </div>
  );
}
