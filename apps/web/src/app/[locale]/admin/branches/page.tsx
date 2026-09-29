'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ROLES, ROLE_LABELS, TENANT_WIDE_ROLES, type Role } from '@mk/shared';
import { Badge, Button, Card, Empty, ErrorNote, Table } from '@/components/ui';
import {
  CheckField,
  FormDialog,
  FormGrid,
  FormSection,
  FullWidth,
  NumberField,
  SelectField,
  Tabs,
  TextField,
  Toolbar,
} from '@/components/admin/form';
import { StaffShell } from '@/components/staff-shell';
import { get, patch, post, put } from '@/lib/api';
import { useDict } from '@/lib/dict';
import { useSession } from '@/lib/session';

interface Branch {
  id: string;
  code: string;
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  pincode: string;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  gstin: string | null;
  geofenceRadiusM: number;
  openingDate: string | null;
  isActive: boolean;
  _count?: { employees: number };
}

interface BranchDetail extends Branch {
  diningTables: { id: string; label: string; seats: number; isActive: boolean }[];
  shifts: { id: string; name: string }[];
}

interface User {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  branchRoles: { id: string; role: Role; branchId: string | null; branch: { name: string; code: string } | null }[];
  employee: { id: string; employeeCode: string; roleType: string } | null;
}

type Tab = 'BRANCHES' | 'PEOPLE';

export default function BranchesPage() {
  return (
    <StaffShell requires="branch:read" title="Branches & access">
      <Admin />
    </StaffShell>
  );
}

function Admin() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('BRANCHES');

  return (
    <div className="space-y-4">
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'BRANCHES', label: 'Branches' },
          { value: 'PEOPLE', label: 'Who can sign in' },
        ]}
      />
      {tab === 'BRANCHES' ? <Branches /> : null}
      {tab === 'PEOPLE' ? (can('user:read') ? <People /> : <Empty>No access</Empty>) : null}
    </div>
  );
}

// ─── Branches ────────────────────────────────────────────────────────────────

/**
 * Branch management.
 *
 * Adding a branch here is the whole of "opening branch #2" as far as the software is
 * concerned: menu prices, stock, staff and reports are all already scoped by branch, so a
 * new one starts empty and fills up. The branch picker in the header appears the moment
 * there is more than one.
 */
function Branches() {
  const dict = useDict();
  const { can, branchId, setBranchId } = useSession();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Branch | 'NEW' | null>(null);
  const [tablesFor, setTablesFor] = useState<Branch | null>(null);

  const query = useQuery({ queryKey: ['branches-admin'], queryFn: () => get<Branch[]>('/branches') });

  return (
    <div className="space-y-3">
      <Toolbar>
        {can('branch:write') ? <Button onClick={() => setEditing('NEW')}>+ Add a branch</Button> : null}
        <span className="text-sm text-ink-400">
          Everything else — menu prices, stock, staff, reports — is already scoped per branch.
        </span>
      </Toolbar>

      <ErrorNote error={query.error} />

      <Table head={['Branch', 'Address', dict.common.phone, 'Staff', 'Opened', dict.common.actions]}>
        {(query.data ?? []).map((b) => (
          <tr key={b.id} className={b.id === branchId ? 'bg-brand-50' : undefined}>
            <td className="px-3 py-2">
              <div className="font-medium">{b.name}</div>
              <div className="text-xs text-ink-400">
                {b.code}
                {b.id === branchId ? ' · currently selected' : ''}
              </div>
            </td>
            <td className="px-3 py-2 text-ink-600">
              {b.addressLine1}
              {b.addressLine2 ? `, ${b.addressLine2}` : ''}
              <div className="text-xs text-ink-400">
                {b.city}, {b.state} {b.pincode}
              </div>
            </td>
            <td className="px-3 py-2">{b.phone ?? '—'}</td>
            <td className="px-3 py-2 tabular-nums">{b._count?.employees ?? '—'}</td>
            <td className="px-3 py-2 tabular-nums">{b.openingDate?.slice(0, 10) ?? '—'}</td>
            <td className="px-3 py-2">
              <div className="flex flex-wrap gap-1.5">
                {b.id !== branchId ? (
                  <Button size="sm" variant="secondary" onClick={() => setBranchId(b.id)}>
                    Work here
                  </Button>
                ) : null}
                {can('branch:write') ? (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(b)}>
                      {dict.common.edit}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setTablesFor(b)}>
                      Tables
                    </Button>
                  </>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
      </Table>

      {editing ? (
        <BranchDialog
          branch={editing === 'NEW' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['branches-admin'] });
            void queryClient.invalidateQueries({ queryKey: ['branches'] });
          }}
        />
      ) : null}

      {tablesFor ? <TablesDialog branch={tablesFor} onClose={() => setTablesFor(null)} /> : null}
    </div>
  );
}

function BranchDialog({ branch, onClose, onDone }: { branch: Branch | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    code: branch?.code ?? '',
    name: branch?.name ?? '',
    addressLine1: branch?.addressLine1 ?? '',
    addressLine2: branch?.addressLine2 ?? '',
    city: branch?.city ?? 'Hyderabad',
    state: branch?.state ?? 'Telangana',
    pincode: branch?.pincode ?? '',
    phone: branch?.phone ?? '',
    gstin: branch?.gstin ?? '',
    lat: branch?.lat ? String(branch.lat) : '',
    lng: branch?.lng ? String(branch.lng) : '',
    geofenceRadiusM: String(branch?.geofenceRadiusM ?? 100),
    openingDate: branch?.openingDate?.slice(0, 10) ?? '',
    isActive: branch?.isActive ?? true,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        addressLine1: form.addressLine1.trim(),
        addressLine2: form.addressLine2 || undefined,
        city: form.city.trim(),
        state: form.state.trim(),
        pincode: form.pincode.trim(),
        phone: form.phone || undefined,
        gstin: form.gstin || undefined,
        lat: form.lat ? Number(form.lat) : undefined,
        lng: form.lng ? Number(form.lng) : undefined,
        geofenceRadiusM: Number(form.geofenceRadiusM) || 100,
        openingDate: form.openingDate || undefined,
        operatingHours: {},
        isActive: form.isActive,
      };
      return branch ? put(`/branches/${branch.id}`, body) : post('/branches', body);
    },
    onSuccess: onDone,
  });

  const valid =
    form.code.trim() && form.name.trim() && form.addressLine1.trim() && form.city.trim() && /^\d{6}$/.test(form.pincode);

  return (
    <FormDialog
      title={branch ? `Edit ${branch.name}` : 'Add a branch'}
      subtitle={branch ? undefined : 'A new branch starts empty. Copy the menu across afterwards.'}
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={!valid}
      wide
    >
      <FormGrid>
        <TextField label="Code" value={form.code} onChange={(v) => set('code', v.toUpperCase())} hint="Short. Appears on invoice numbers." required disabled={!!branch} autoFocus={!branch} />
        <TextField label="Name" value={form.name} onChange={(v) => set('name', v)} required />
        <FullWidth>
          <TextField label="Address" value={form.addressLine1} onChange={(v) => set('addressLine1', v)} required />
        </FullWidth>
        <TextField label="Area" value={form.addressLine2} onChange={(v) => set('addressLine2', v)} />
        <TextField label="City" value={form.city} onChange={(v) => set('city', v)} required />
        <TextField label="State" value={form.state} onChange={(v) => set('state', v)} required />
        <TextField label="Pincode" value={form.pincode} onChange={(v) => set('pincode', v.replace(/\D/g, ''))} required />
        <TextField label="Phone" value={form.phone} onChange={(v) => set('phone', v.replace(/\D/g, ''))} />
        <TextField label="Opening date" value={form.openingDate} onChange={(v) => set('openingDate', v)} type="date" />
      </FormGrid>

      <FormSection title="Tax and attendance">
        <FormGrid>
          <TextField
            label="Branch GSTIN"
            value={form.gstin}
            onChange={(v) => set('gstin', v.toUpperCase())}
            hint="Needed once branches cross state lines"
          />
          <NumberField
            label="Geofence radius"
            value={form.geofenceRadiusM}
            onChange={(v) => set('geofenceRadiusM', v)}
            min={20}
            max={1000}
            suffix="m"
            hint="How far from the shop a mobile punch is still accepted"
          />
          <TextField label="Latitude" value={form.lat} onChange={(v) => set('lat', v)} hint="From Google Maps" />
          <TextField label="Longitude" value={form.lng} onChange={(v) => set('lng', v)} />
        </FormGrid>
      </FormSection>

      <CheckField
        label="Open"
        checked={form.isActive}
        onChange={(v) => set('isActive', v)}
        hint="Closing a branch hides it everywhere but keeps its history intact."
      />
    </FormDialog>
  );
}

function TablesDialog({ branch, onClose }: { branch: Branch; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [seats, setSeats] = useState('4');

  const detail = useQuery({
    queryKey: ['branch', branch.id],
    queryFn: () => get<BranchDetail>(`/branches/${branch.id}`),
  });

  const mutation = useMutation({
    mutationFn: () =>
      post('/branches/tables', { branchId: branch.id, label: label.trim(), seats: Number(seats) || 4, isActive: true }),
    onSuccess: () => {
      setLabel('');
      void queryClient.invalidateQueries({ queryKey: ['branch', branch.id] });
    },
  });

  return (
    <FormDialog
      title={`Tables at ${branch.name}`}
      subtitle="Used by the POS for dine-in orders."
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      submitLabel="Add table"
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={!label.trim()}
    >
      <FormGrid>
        <TextField label="Label" value={label} onChange={setLabel} placeholder="T5" autoFocus />
        <NumberField label="Seats" value={seats} onChange={setSeats} min={1} max={20} />
      </FormGrid>

      <div className="flex flex-wrap gap-1.5">
        {(detail.data?.diningTables ?? []).map((t) => (
          <Badge key={t.id} tone="neutral">
            {t.label} · {t.seats}
          </Badge>
        ))}
        {(detail.data?.diningTables ?? []).length === 0 ? (
          <span className="text-sm text-ink-400">No tables yet — takeaway-only is fine.</span>
        ) : null}
      </div>
    </FormDialog>
  );
}

// ─── People and access ───────────────────────────────────────────────────────

/**
 * Who can sign in, and to what.
 *
 * Access is granted per (person, branch), not globally — so a manager can run Tellapur
 * and be a helper at branch #2, and neither grant leaks into the other. Owner, partner
 * and accountant are the exceptions: those are business-wide by nature.
 */
function People() {
  const dict = useDict();
  const { can, session } = useSession();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [granting, setGranting] = useState<User | null>(null);
  const [created, setCreated] = useState<{ name: string; password: string } | null>(null);

  const users = useQuery({ queryKey: ['users'], queryFn: () => get<User[]>('/users') });

  const setActive = useMutation({
    mutationFn: (vars: { id: string; isActive: boolean }) => patch(`/users/${vars.id}/active`, { isActive: vars.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const revoke = useMutation({
    mutationFn: (grantId: string) => post(`/users/grants/${grantId}/revoke`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <div className="space-y-3">
      {created ? (
        <Card className="!border-brand-400 !bg-brand-50">
          <h2 className="font-medium text-brand-800">Login created for {created.name}</h2>
          <p className="mt-1 text-sm text-ink-800">
            Temporary password: <code className="rounded bg-white px-2 py-0.5 font-mono">{created.password}</code>
          </p>
          <p className="mt-2 text-sm text-ink-600">
            Hand this over in person and have them change it. It is shown once and is not recoverable —
            create a new login if it is lost.
          </p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => setCreated(null)}>
            Got it
          </Button>
        </Card>
      ) : null}

      <Toolbar>
        {can('user:write') ? <Button onClick={() => setCreating(true)}>+ Add a login</Button> : null}
        <span className="text-sm text-ink-400">
          Not everyone needs one — a helper who only punches in can use the wall QR instead.
        </span>
      </Toolbar>

      <ErrorNote error={users.error} />
      <ErrorNote error={setActive.error} />
      <ErrorNote error={revoke.error} />

      <Table head={[dict.common.name, 'Signs in with', 'Can do', 'Last seen', dict.common.actions]}>
        {(users.data ?? []).map((u) => (
          <tr key={u.id} className={u.isActive ? undefined : 'opacity-50'}>
            <td className="px-3 py-2">
              <div className="font-medium">{u.name}</div>
              <div className="text-xs text-ink-400">
                {u.employee ? `${u.employee.employeeCode} · ${u.employee.roleType.toLowerCase()}` : 'no staff record linked'}
                {u.totpEnabled ? ' · 2FA on' : ''}
              </div>
            </td>
            <td className="px-3 py-2 text-ink-600">{u.email ?? u.phone ?? '—'}</td>
            <td className="px-3 py-2">
              <div className="flex flex-wrap gap-1">
                {u.branchRoles.map((g) => (
                  <span key={g.id} className="inline-flex items-center gap-1">
                    <Badge tone={g.branchId === null ? 'brand' : 'neutral'}>
                      {ROLE_LABELS[g.role]}
                      {g.branch ? ` · ${g.branch.code}` : ' · everywhere'}
                    </Badge>
                    {can('role:grant') ? (
                      <button
                        className="text-xs text-red-600"
                        title="Revoke"
                        onClick={() => revoke.mutate(g.id)}
                      >
                        ✕
                      </button>
                    ) : null}
                  </span>
                ))}
                {u.branchRoles.length === 0 ? <span className="text-xs text-red-600">no access</span> : null}
              </div>
            </td>
            <td className="px-3 py-2 tabular-nums text-ink-600">
              {u.lastLoginAt ? u.lastLoginAt.slice(0, 10) : 'never'}
            </td>
            <td className="px-3 py-2">
              <div className="flex flex-wrap gap-1.5">
                {can('role:grant') ? (
                  <Button size="sm" variant="secondary" onClick={() => setGranting(u)}>
                    Give access
                  </Button>
                ) : null}
                {can('user:write') && session?.kind === 'STAFF' && session.id !== u.id ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className={u.isActive ? '!text-red-600' : ''}
                    onClick={() => setActive.mutate({ id: u.id, isActive: !u.isActive })}
                  >
                    {u.isActive ? 'Disable' : 'Enable'}
                  </Button>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
      </Table>

      {creating ? (
        <UserDialog
          onClose={() => setCreating(false)}
          onDone={(name, password) => {
            setCreating(false);
            setCreated({ name, password });
            void queryClient.invalidateQueries({ queryKey: ['users'] });
          }}
        />
      ) : null}

      {granting ? (
        <GrantDialog
          user={granting}
          onClose={() => setGranting(null)}
          onDone={() => {
            setGranting(null);
            void queryClient.invalidateQueries({ queryKey: ['users'] });
          }}
        />
      ) : null}
    </div>
  );
}

function UserDialog({ onClose, onDone }: { onClose: () => void; onDone: (name: string, password: string) => void }) {
  const { branchId } = useSession();
  const branches = useQuery({ queryKey: ['branches-admin'], queryFn: () => get<Branch[]>('/branches') });
  const employees = useQuery({
    queryKey: ['employees', branchId],
    enabled: !!branchId,
    queryFn: () => get<{ id: string; name: string; employeeCode: string; user: unknown }[]>(`/staff/employees?branchId=${branchId}`),
  });

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'HELPER' as Role,
    branchId: branchId ?? '',
    employeeId: '',
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const tenantWide = TENANT_WIDE_ROLES.includes(form.role);

  const mutation = useMutation({
    mutationFn: () =>
      post<{ user: { name: string }; temporaryPassword: string }>('/users', {
        name: form.name.trim(),
        email: form.email || undefined,
        phone: form.phone || undefined,
        role: form.role,
        branchId: tenantWide ? null : form.branchId,
        employeeId: form.employeeId || undefined,
      }),
    onSuccess: (res) => onDone(res.user.name, res.temporaryPassword),
  });

  return (
    <FormDialog
      title="Add a login"
      subtitle="Creates a temporary password shown once, to hand over in person."
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={!form.name.trim() || (!form.email && !form.phone) || (!tenantWide && !form.branchId)}
      submitLabel="Create login"
      wide
    >
      <FormGrid>
        <TextField label="Name" value={form.name} onChange={(v) => set('name', v)} required autoFocus />
        <SelectField
          label="Role"
          value={form.role}
          onChange={(v) => set('role', v as Role)}
          options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
          required
        />
        <TextField label="Email" value={form.email} onChange={(v) => set('email', v)} type="email" hint="Either this or a phone" />
        <TextField label="Phone" value={form.phone} onChange={(v) => set('phone', v.replace(/\D/g, ''))} hint="Many staff prefer this" />
        <SelectField
          label="At which branch"
          value={tenantWide ? '' : form.branchId}
          onChange={(v) => set('branchId', v)}
          options={(branches.data ?? []).map((b) => ({ value: b.id, label: b.name }))}
          placeholder={tenantWide ? 'Everywhere — this role is business-wide' : 'Choose…'}
          hint={tenantWide ? `${ROLE_LABELS[form.role]} covers the whole business` : undefined}
        />
        <SelectField
          label="Link to staff record"
          value={form.employeeId}
          onChange={(v) => set('employeeId', v)}
          placeholder="Not linked"
          options={(employees.data ?? [])
            .filter((e) => !e.user)
            .map((e) => ({ value: e.id, label: `${e.name} (${e.employeeCode})` }))}
          hint="Needed for them to punch their own attendance"
        />
      </FormGrid>

      <RolePreview role={form.role} />
    </FormDialog>
  );
}

function GrantDialog({ user, onClose, onDone }: { user: User; onClose: () => void; onDone: () => void }) {
  const { branchId } = useSession();
  const branches = useQuery({ queryKey: ['branches-admin'], queryFn: () => get<Branch[]>('/branches') });
  const [role, setRole] = useState<Role>('MANAGER');
  const [branch, setBranch] = useState(branchId ?? '');
  const tenantWide = TENANT_WIDE_ROLES.includes(role);

  const mutation = useMutation({
    mutationFn: () => post('/users/grants', { userId: user.id, role, branchId: tenantWide ? null : branch }),
    onSuccess: onDone,
  });

  return (
    <FormDialog
      title={`Give ${user.name} access`}
      subtitle="Access is per branch, so someone can manage one and help at another."
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={!tenantWide && !branch}
      submitLabel="Grant"
    >
      <FormGrid>
        <SelectField
          label="Role"
          value={role}
          onChange={(v) => setRole(v as Role)}
          options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
        />
        <SelectField
          label="Branch"
          value={tenantWide ? '' : branch}
          onChange={setBranch}
          options={(branches.data ?? []).map((b) => ({ value: b.id, label: b.name }))}
          placeholder={tenantWide ? 'Everywhere' : 'Choose…'}
        />
      </FormGrid>
      <RolePreview role={role} />
    </FormDialog>
  );
}

/** What a role actually lets someone do, in plain language rather than permission strings. */
function RolePreview({ role }: { role: Role }) {
  const summary: Record<Role, string> = {
    OWNER: 'Everything, including legal documents, payroll, and changing other people’s access.',
    PARTNER: 'Everything operational — money, stock, staff, documents — but cannot change another partner’s access.',
    MANAGER: 'Runs one branch: menu, orders, stock, vendors, purchase orders, attendance, branch reports. No payroll approval.',
    CHEF: 'Kitchen screen, stock issues and wastage, recipes to read, own attendance. No prices, no reports.',
    HELPER: 'Takes orders and settles them, sees the kitchen queue, punches own attendance. No cost prices, no reports, no discounts.',
    ACCOUNTANT: 'Reads everything financial across branches and records vendor payments. Cannot change the menu or staff.',
  };
  return (
    <div className="rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-600">
      <strong className="text-ink-800">{ROLE_LABELS[role]}:</strong> {summary[role]}
    </div>
  );
}
