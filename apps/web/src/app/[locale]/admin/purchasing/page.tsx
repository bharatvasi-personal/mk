'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formatMinor } from '@mk/shared';
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
  Tabs,
  TextField,
  Toolbar,
} from '@/components/admin/form';
import { StaffShell } from '@/components/staff-shell';
import { get, post, put } from '@/lib/api';
import { useDict } from '@/lib/dict';
import { useSession } from '@/lib/session';

interface Vendor {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  category: string | null;
  creditDays: number;
  gstin: string | null;
  upiId: string | null;
  addressLine1: string | null;
  city: string | null;
  pincode: string | null;
  notes: string | null;
  isActive: boolean;
}

interface Payable {
  id: string;
  vendor: { id: string; name: string; phone: string | null; upiId: string | null; creditDays: number };
  billNo: string;
  billDate: string;
  dueOn: string;
  totalMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  status: string;
  daysOverdue: number;
  isOverdue: boolean;
}

interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  avgCostMinor: number;
  uom: { code: string };
}

interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: string;
  expectedOn: string | null;
  totalMinor: number;
  createdAt: string;
  vendor: { name: string; phone: string | null };
  lines: {
    id: string;
    orderedQty: string;
    receivedQty: string;
    unitPriceMinor: number;
    item: { name: string; sku: string; uom: { code: string } };
  }[];
}

type Tab = 'PAYABLES' | 'ORDERS' | 'RECEIVE' | 'VENDORS';

export default function PurchasingPage() {
  return (
    <StaffShell requires="vendor:read" title="Purchasing">
      <Purchasing />
    </StaffShell>
  );
}

function Purchasing() {
  const dict = useDict();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('PAYABLES');

  return (
    <div className="space-y-4">
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'PAYABLES', label: 'What I owe' },
          { value: 'ORDERS', label: 'Purchase orders' },
          { value: 'RECEIVE', label: 'Receive stock & bill' },
          { value: 'VENDORS', label: dict.admin.vendors },
        ]}
      />

      {tab === 'PAYABLES' ? <Payables canPay={can('payable:pay')} /> : null}
      {tab === 'ORDERS' ? <PurchaseOrders /> : null}
      {tab === 'RECEIVE' ? (can('grn:create') ? <ReceiveGoods /> : <Empty>{dict.auth.noAccess}</Empty>) : null}
      {tab === 'VENDORS' ? <Vendors /> : null}
    </div>
  );
}

// ─── Vendors ─────────────────────────────────────────────────────────────────

/**
 * The vendor directory, with the credit terms that drive everything downstream.
 *
 * `creditDays` is the field that matters most and the one nobody thinks to fill in: the
 * due date on every bill from this supplier is computed from it, and the payables screen
 * sorts by that date. Get it wrong and you either pay early for no reason or lose a
 * supplier over a bill you did not know was late.
 */
function Vendors() {
  const dict = useDict();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Vendor | 'NEW' | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const query = useQuery({
    queryKey: ['vendors', showInactive],
    queryFn: () => get<Vendor[]>(`/vendors${showInactive ? '?all=true' : ''}`),
  });

  return (
    <div className="space-y-3">
      <Toolbar>
        {can('vendor:write') ? <Button onClick={() => setEditing('NEW')}>+ Add vendor</Button> : null}
        <label className="flex items-center gap-2 text-sm text-ink-600">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </Toolbar>

      <ErrorNote error={query.error} />

      {(query.data?.length ?? 0) === 0 ? (
        <Empty>No vendors yet. Add the kirana shop, the vegetable mandi and the gas agency first.</Empty>
      ) : (
        <Table
          head={[
            dict.common.name,
            'Supplies',
            dict.common.phone,
            dict.vendors.creditDays,
            'UPI',
            ...(can('vendor:write') ? [dict.common.actions] : []),
          ]}
        >
          {(query.data ?? []).map((v) => (
            <tr key={v.id} className={v.isActive ? undefined : 'opacity-50'}>
              <td className="px-3 py-2">
                <div className="font-medium">{v.name}</div>
                <div className="text-xs text-ink-400">
                  {v.code}
                  {v.contactName ? ` · ${v.contactName}` : ''}
                  {v.isActive ? '' : ' · inactive'}
                </div>
              </td>
              <td className="px-3 py-2">{v.category ?? '—'}</td>
              <td className="px-3 py-2">
                {v.phone ? (
                  <a className="text-brand-700 underline" href={`tel:${v.phone}`}>
                    {v.phone}
                  </a>
                ) : (
                  '—'
                )}
              </td>
              <td className="px-3 py-2 tabular-nums">
                {v.creditDays === 0 ? <Badge tone="neutral">cash</Badge> : `${v.creditDays} days`}
              </td>
              <td className="px-3 py-2 text-xs">{v.upiId ?? '—'}</td>
              {can('vendor:write') ? (
                <td className="px-3 py-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(v)}>
                    {dict.common.edit}
                  </Button>
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      )}

      {editing ? (
        <VendorDialog
          vendor={editing === 'NEW' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['vendors'] });
          }}
        />
      ) : null}
    </div>
  );
}

function VendorDialog({
  vendor,
  onClose,
  onDone,
}: {
  vendor: Vendor | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    code: vendor?.code ?? '',
    name: vendor?.name ?? '',
    contactName: vendor?.contactName ?? '',
    phone: vendor?.phone ?? '',
    altPhone: vendor?.altPhone ?? '',
    email: vendor?.email ?? '',
    category: vendor?.category ?? '',
    creditDays: String(vendor?.creditDays ?? 0),
    gstin: vendor?.gstin ?? '',
    upiId: vendor?.upiId ?? '',
    addressLine1: vendor?.addressLine1 ?? '',
    city: vendor?.city ?? '',
    pincode: vendor?.pincode ?? '',
    notes: vendor?.notes ?? '',
    isActive: vendor?.isActive ?? true,
  });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: () => {
      // Empty strings are dropped rather than sent: the API validates an email or a GSTIN
      // if one is present, and "" is not a valid either.
      const body = {
        code: form.code.trim(),
        name: form.name.trim(),
        contactName: form.contactName || undefined,
        phone: form.phone || undefined,
        altPhone: form.altPhone || undefined,
        email: form.email || undefined,
        category: form.category || undefined,
        creditDays: Number(form.creditDays) || 0,
        gstin: form.gstin || undefined,
        upiId: form.upiId || undefined,
        addressLine1: form.addressLine1 || undefined,
        city: form.city || undefined,
        pincode: form.pincode || undefined,
        notes: form.notes || undefined,
        isActive: form.isActive,
      };
      return vendor ? put(`/vendors/${vendor.id}`, body) : post('/vendors', body);
    },
    onSuccess: onDone,
  });

  return (
    <FormDialog
      title={vendor ? `Edit ${vendor.name}` : 'Add a vendor'}
      subtitle="Credit days decide when every bill from this supplier falls due."
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={!form.code.trim() || !form.name.trim()}
      wide
    >
      <FormGrid>
        <TextField
          label="Short code"
          value={form.code}
          onChange={(v) => set('code', v.toUpperCase())}
          hint="Used on purchase orders. e.g. KIRANA-SL"
          required
          autoFocus={!vendor}
          disabled={!!vendor}
        />
        <TextField label="Business name" value={form.name} onChange={(v) => set('name', v)} required />
        <TextField label="Contact person" value={form.contactName} onChange={(v) => set('contactName', v)} />
        <TextField label="What they supply" value={form.category} onChange={(v) => set('category', v)} placeholder="Vegetables, Groceries, LPG…" />
        <TextField label="Phone" value={form.phone} onChange={(v) => set('phone', v.replace(/\D/g, ''))} hint="10 digits" />
        <TextField label="Alternate phone" value={form.altPhone} onChange={(v) => set('altPhone', v.replace(/\D/g, ''))} />
        <NumberField
          label="Credit days"
          value={form.creditDays}
          onChange={(v) => set('creditDays', v)}
          min={0}
          max={180}
          hint="0 = pay on delivery. Most local suppliers give 7–15."
        />
        <TextField label="UPI ID" value={form.upiId} onChange={(v) => set('upiId', v)} hint="For paying them" />
      </FormGrid>

      <FormSection title="Optional">
        <FormGrid>
          <TextField label="GSTIN" value={form.gstin} onChange={(v) => set('gstin', v.toUpperCase())} hint="Only if they are registered" />
          <TextField label="Email" value={form.email} onChange={(v) => set('email', v)} type="email" />
          <FullWidth>
            <TextField label="Address" value={form.addressLine1} onChange={(v) => set('addressLine1', v)} />
          </FullWidth>
          <TextField label="City" value={form.city} onChange={(v) => set('city', v)} />
          <TextField label="Pincode" value={form.pincode} onChange={(v) => set('pincode', v.replace(/\D/g, ''))} />
          <FullWidth>
            <TextField label="Notes" value={form.notes} onChange={(v) => set('notes', v)} placeholder="Delivers before 7am, closed Tuesdays…" />
          </FullWidth>
          <FullWidth>
            <CheckField
              label="Active"
              checked={form.isActive}
              onChange={(v) => set('isActive', v)}
              hint="Inactive vendors stay on old bills but disappear from the pickers. Vendors are never deleted — you cannot delete someone you have paid."
            />
          </FullWidth>
        </FormGrid>
      </FormSection>
    </FormDialog>
  );
}

// ─── Purchase orders ─────────────────────────────────────────────────────────

/**
 * A purchase order is what you send the vendor *before* the goods arrive: "bring me this
 * much, at this price". It is not the bill — the bill is what they hand over on delivery,
 * and that is recorded on the Receive tab.
 *
 * Both exist because at a mandi they routinely disagree, and the gap between what you
 * ordered and what turned up is the thing worth being able to see.
 */
function PurchaseOrders() {
  const dict = useDict();
  const { branchId, can } = useSession();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const query = useQuery({
    queryKey: ['purchase-orders', branchId],
    enabled: !!branchId,
    queryFn: () => get<PurchaseOrder[]>(`/vendors/purchase-orders/${branchId}`),
  });

  return (
    <div className="space-y-3">
      <Toolbar>
        {can('po:create') ? <Button onClick={() => setCreating(true)}>+ New purchase order</Button> : null}
        <span className="text-sm text-ink-400">
          Send this to the vendor. Record what actually arrives on the Receive tab.
        </span>
      </Toolbar>

      <ErrorNote error={query.error} />

      {(query.data?.length ?? 0) === 0 ? (
        <Empty>
          No purchase orders. For a daily vegetable run you may never need one — go straight to Receive
          stock. They earn their keep for weekly and monthly orders you want a record of.
        </Empty>
      ) : (
        <Table head={['PO', dict.admin.vendors, 'Expected', 'Items', dict.common.total, dict.common.status]}>
          {(query.data ?? []).map((po) => (
            <tr key={po.id}>
              <td className="px-3 py-2 font-medium">{po.poNumber}</td>
              <td className="px-3 py-2">{po.vendor.name}</td>
              <td className="px-3 py-2 tabular-nums">{po.expectedOn?.slice(0, 10) ?? '—'}</td>
              <td className="px-3 py-2">
                {po.lines.map((l) => (
                  <div key={l.id} className="text-xs">
                    {l.item.name} — {Number(l.orderedQty)} {l.item.uom.code}
                    {Number(l.receivedQty) > 0 ? (
                      <span className="text-leaf-600"> (got {Number(l.receivedQty)})</span>
                    ) : null}
                  </div>
                ))}
              </td>
              <td className="px-3 py-2 tabular-nums">{formatMinor(po.totalMinor)}</td>
              <td className="px-3 py-2">
                <Badge
                  tone={po.status === 'RECEIVED' ? 'good' : po.status === 'PARTIALLY_RECEIVED' ? 'warn' : 'neutral'}
                >
                  {po.status.replace(/_/g, ' ').toLowerCase()}
                </Badge>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {creating ? (
        <PurchaseOrderDialog
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ['purchase-orders', branchId] });
          }}
        />
      ) : null}
    </div>
  );
}

function PurchaseOrderDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { branchId } = useSession();
  const [vendorId, setVendorId] = useState('');
  const [expectedOn, setExpectedOn] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<{ inventoryItemId: string; orderedQty: string; unitPriceMinor: number }[]>([
    { inventoryItemId: '', orderedQty: '', unitPriceMinor: 0 },
  ]);

  const vendors = useQuery({ queryKey: ['vendors', false], queryFn: () => get<Vendor[]>('/vendors') });
  const items = useQuery({ queryKey: ['inv-items'], queryFn: () => get<InventoryItem[]>('/inventory/items') });

  const total = lines.reduce((s, l) => s + Number(l.orderedQty || 0) * l.unitPriceMinor, 0);

  const mutation = useMutation({
    mutationFn: () =>
      post('/vendors/purchase-orders', {
        branchId,
        vendorId,
        expectedOn: expectedOn || undefined,
        notes: notes || undefined,
        lines: lines
          .filter((l) => l.inventoryItemId && Number(l.orderedQty) > 0)
          .map((l) => ({ ...l, gstRateBp: 0 })),
      }),
    onSuccess: onDone,
  });

  const valid = vendorId && lines.some((l) => l.inventoryItemId && Number(l.orderedQty) > 0);

  return (
    <FormDialog
      title="New purchase order"
      subtitle="What you are asking the vendor to send."
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={!valid}
      submitLabel="Raise order"
      wide
    >
      <FormGrid>
        <SelectField
          label="Vendor"
          value={vendorId}
          onChange={setVendorId}
          required
          placeholder="Choose…"
          options={(vendors.data ?? []).map((v) => ({
            value: v.id,
            label: `${v.name}${v.creditDays ? ` (${v.creditDays}d credit)` : ' (cash)'}`,
          }))}
        />
        <TextField label="Expected on" value={expectedOn} onChange={setExpectedOn} type="date" />
      </FormGrid>

      <LineEditor lines={lines} setLines={setLines} items={items.data ?? []} qtyLabel="Order" />

      <TextField label="Notes" value={notes} onChange={setNotes} />

      <div className="flex justify-between border-t border-ink-100 pt-2 text-sm">
        <span className="text-ink-600">Order value</span>
        <span className="font-semibold tabular-nums">{formatMinor(total)}</span>
      </div>
    </FormDialog>
  );
}

// ─── Receive stock, and the vendor's bill ────────────────────────────────────

/**
 * Recording what arrived, and the bill that came with it.
 *
 * This is the screen that answers "how do I enter the bill from the kirana shop": you
 * list what turned up, put their bill number and date on it, and the system adds the
 * stock, updates the weighted-average cost, and creates a payable due on
 * bill date + their credit days.
 *
 * The bill number is optional because at a mandi the goods often arrive before the
 * paperwork. Receive the stock now; attach the bill when it turns up.
 */
function ReceiveGoods() {
  const dict = useDict();
  const { branchId } = useSession();
  const queryClient = useQueryClient();
  const [vendorId, setVendorId] = useState('');
  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<{ inventoryItemId: string; orderedQty: string; unitPriceMinor: number }[]>([
    { inventoryItemId: '', orderedQty: '', unitPriceMinor: 0 },
  ]);
  const [done, setDone] = useState<{ reference: string; billNo?: string; dueOn?: string } | null>(null);

  const vendors = useQuery({ queryKey: ['vendors', false], queryFn: () => get<Vendor[]>('/vendors') });
  const items = useQuery({ queryKey: ['inv-items'], queryFn: () => get<InventoryItem[]>('/inventory/items') });

  const total = lines.reduce((s, l) => s + Number(l.orderedQty || 0) * l.unitPriceMinor, 0);

  const mutation = useMutation({
    mutationFn: () =>
      post<{ receipt: { reference: string }; vendorInvoice: { billNo: string; dueOn: string } | null }>(
        '/vendors/receipts',
        {
          branchId,
          vendorId,
          billNo: billNo || undefined,
          billDate: billNo ? billDate : undefined,
          notes: notes || undefined,
          lines: lines
            .filter((l) => l.inventoryItemId && Number(l.orderedQty) > 0)
            .map((l) => ({
              inventoryItemId: l.inventoryItemId,
              receivedQty: l.orderedQty,
              rejectedQty: '0',
              unitPriceMinor: l.unitPriceMinor,
            })),
        },
      ),
    onSuccess: (res) => {
      setDone({
        reference: res.receipt.reference,
        billNo: res.vendorInvoice?.billNo,
        dueOn: res.vendorInvoice?.dueOn?.slice(0, 10),
      });
      setLines([{ inventoryItemId: '', orderedQty: '', unitPriceMinor: 0 }]);
      setBillNo('');
      void queryClient.invalidateQueries({ queryKey: ['on-hand', branchId] });
      void queryClient.invalidateQueries({ queryKey: ['payables'] });
    },
  });

  const valid = vendorId && lines.some((l) => l.inventoryItemId && Number(l.orderedQty) > 0);
  const vendor = vendors.data?.find((v) => v.id === vendorId);

  return (
    <div className="space-y-3">
      {done ? (
        <Card className="!border-leaf-500 !bg-leaf-100">
          <h2 className="font-medium text-leaf-600">Stock received · {done.reference}</h2>
          <p className="mt-1 text-sm text-ink-800">
            {done.billNo
              ? `Bill ${done.billNo} recorded, due ${done.dueOn}. It is now on the "What I owe" tab.`
              : 'No bill number given, so nothing was added to payables. Receive again with the bill number when it arrives.'}
          </p>
        </Card>
      ) : null}

      <Card>
        <FormGrid>
          <SelectField
            label="Vendor"
            value={vendorId}
            onChange={setVendorId}
            required
            placeholder="Who did this come from?"
            options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
          />
          <div />
          <TextField
            label="Their bill number"
            value={billNo}
            onChange={setBillNo}
            hint={
              vendor
                ? `Leave blank if the bill has not arrived. With a bill, payment is due in ${vendor.creditDays} days.`
                : 'Optional — attach it later if the bill follows the delivery'
            }
          />
          <TextField label="Bill date" value={billDate} onChange={setBillDate} type="date" />
        </FormGrid>

        <div className="mt-3">
          <LineEditor lines={lines} setLines={setLines} items={items.data ?? []} qtyLabel="Received" />
        </div>

        <TextField label="Notes" value={notes} onChange={setNotes} />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-3">
          <div className="text-sm text-ink-600">
            {dict.common.total}: <strong className="tabular-nums">{formatMinor(total)}</strong>
            {vendor && billNo ? (
              <span className="ml-2 text-ink-400">
                due{' '}
                {new Date(new Date(billDate).getTime() + vendor.creditDays * 86_400_000)
                  .toISOString()
                  .slice(0, 10)}
              </span>
            ) : null}
          </div>
          <Button disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? dict.common.saving : 'Receive stock'}
          </Button>
        </div>

        <ErrorNote error={mutation.error} />
      </Card>
    </div>
  );
}

/** Shared line editor for purchase orders and goods receipts. */
function LineEditor({
  lines,
  setLines,
  items,
  qtyLabel,
}: {
  lines: { inventoryItemId: string; orderedQty: string; unitPriceMinor: number }[];
  setLines: (fn: (l: typeof lines) => typeof lines) => void;
  items: InventoryItem[];
  qtyLabel: string;
}) {
  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-[1fr_6rem_7rem_2.5rem] gap-2 text-xs uppercase tracking-wide text-ink-400 sm:grid">
        <span>Item</span>
        <span className="text-right">{qtyLabel}</span>
        <span className="text-right">Rate ₹</span>
        <span />
      </div>

      {lines.map((line, index) => {
        const item = items.find((i) => i.id === line.inventoryItemId);
        return (
          <div key={index} className="grid grid-cols-[1fr_5rem_6rem_2.5rem] items-center gap-2">
            <select
              className="w-full rounded-lg border border-ink-200 bg-white px-2 py-2 text-sm"
              value={line.inventoryItemId}
              onChange={(e) => {
                const picked = items.find((i) => i.id === e.target.value);
                setLines((ls) =>
                  ls.map((l, i) =>
                    i === index
                      ? {
                          ...l,
                          inventoryItemId: e.target.value,
                          // Prefill the last known cost — usually right, always editable.
                          unitPriceMinor: l.unitPriceMinor || (picked?.avgCostMinor ?? 0),
                        }
                      : l,
                  ),
                );
              }}
            >
              <option value="">Choose an item…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.uom.code})
                </option>
              ))}
            </select>

            <input
              className="w-full rounded-lg border border-ink-200 px-2 py-2 text-right text-sm tabular-nums"
              type="number"
              step="0.001"
              placeholder={item?.uom.code ?? 'qty'}
              value={line.orderedQty}
              onChange={(e) =>
                setLines((ls) => ls.map((l, i) => (i === index ? { ...l, orderedQty: e.target.value } : l)))
              }
            />

            <input
              className="w-full rounded-lg border border-ink-200 px-2 py-2 text-right text-sm tabular-nums"
              type="number"
              step="0.01"
              value={line.unitPriceMinor ? line.unitPriceMinor / 100 : ''}
              onChange={(e) =>
                setLines((ls) =>
                  ls.map((l, i) =>
                    i === index ? { ...l, unitPriceMinor: Math.round(Number(e.target.value) * 100) } : l,
                  ),
                )
              }
            />

            <Button
              type="button"
              variant="ghost"
              onClick={() => setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, i) => i !== index)))}
              aria-label="Remove line"
            >
              ✕
            </Button>
          </div>
        );
      })}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setLines((ls) => [...ls, { inventoryItemId: '', orderedQty: '', unitPriceMinor: 0 }])}
      >
        + Add a line
      </Button>
    </div>
  );
}

// ─── Payables ────────────────────────────────────────────────────────────────

function Payables({ canPay }: { canPay: boolean }) {
  const dict = useDict();
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState<Payable | null>(null);

  const query = useQuery({ queryKey: ['payables'], queryFn: () => get<Payable[]>('/vendors/payables/list') });

  const total = (query.data ?? []).reduce((s, p) => s + p.outstandingMinor, 0);
  const overdue = (query.data ?? []).filter((p) => p.isOverdue).reduce((s, p) => s + p.outstandingMinor, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <span>
          Outstanding: <strong className="tabular-nums">{formatMinor(total)}</strong>
        </span>
        {overdue > 0 ? (
          <span className="text-red-600">
            Overdue: <strong className="tabular-nums">{formatMinor(overdue)}</strong>
          </span>
        ) : null}
      </div>

      <ErrorNote error={query.error} />

      {(query.data?.length ?? 0) === 0 ? (
        <Empty>Nothing outstanding. Bills appear here when you receive stock with a bill number.</Empty>
      ) : (
        <Table
          head={[
            dict.admin.vendors,
            'Bill',
            dict.common.date,
            'Due',
            dict.common.amount,
            dict.common.status,
            ...(canPay ? [dict.common.actions] : []),
          ]}
        >
          {(query.data ?? []).map((p) => (
            <tr key={p.id} className={p.isOverdue ? 'bg-red-50' : undefined}>
              <td className="px-3 py-2">
                <div className="font-medium">{p.vendor.name}</div>
                {p.vendor.phone ? (
                  <a className="text-xs text-brand-700 underline" href={`tel:${p.vendor.phone}`}>
                    {p.vendor.phone}
                  </a>
                ) : null}
              </td>
              <td className="px-3 py-2">{p.billNo}</td>
              <td className="px-3 py-2 tabular-nums">{p.billDate.slice(0, 10)}</td>
              <td className="px-3 py-2 tabular-nums">
                {p.dueOn.slice(0, 10)}
                {p.isOverdue ? <div className="text-xs text-red-600">{p.daysOverdue}d late</div> : null}
              </td>
              <td className="px-3 py-2 font-medium tabular-nums">{formatMinor(p.outstandingMinor)}</td>
              <td className="px-3 py-2">
                <Badge tone={p.isOverdue ? 'bad' : p.status === 'PARTIALLY_PAID' ? 'warn' : 'neutral'}>
                  {p.status.replace('_', ' ').toLowerCase()}
                </Badge>
              </td>
              {canPay ? (
                <td className="px-3 py-2">
                  <Button size="sm" onClick={() => setPaying(p)}>
                    Record payment
                  </Button>
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      )}

      {paying ? (
        <PayDialog
          payable={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            void queryClient.invalidateQueries({ queryKey: ['payables'] });
          }}
        />
      ) : null}
    </div>
  );
}

function PayDialog({ payable, onClose, onDone }: { payable: Payable; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(payable.outstandingMinor);
  const [method, setMethod] = useState('UPI');
  const [reference, setReference] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      post('/vendors/payments', {
        vendorId: payable.vendor.id,
        amountMinor: amount,
        method,
        reference: reference || undefined,
        allocations: [{ vendorInvoiceId: payable.id, amountMinor: amount }],
      }),
    onSuccess: onDone,
  });

  return (
    <FormDialog
      title={`Pay ${payable.vendor.name}`}
      subtitle={`${payable.billNo} · ${formatMinor(payable.outstandingMinor)} outstanding${payable.vendor.upiId ? ` · ${payable.vendor.upiId}` : ''}`}
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={amount <= 0 || amount > payable.outstandingMinor}
      submitLabel="Record payment"
    >
      <MoneyField label="Amount" minor={amount} onChange={setAmount} required />
      <SelectField
        label="Paid by"
        value={method}
        onChange={setMethod}
        options={['UPI', 'CASH', 'NEFT', 'IMPS', 'CHEQUE'].map((m) => ({ value: m, label: m }))}
      />
      <TextField
        label="Reference"
        value={reference}
        onChange={setReference}
        hint="UTR or cheque number — this is what matches the bank statement at month end"
      />
    </FormDialog>
  );
}
