'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { BUYING_RHYTHMS, INVENTORY_CATEGORIES, formatMinor } from '@mk/shared';
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

interface OnHandRow {
  inventoryItemId: string;
  sku: string;
  name: string;
  category: string;
  buyingRhythm: string;
  uom: string;
  onHandQty: string;
  reorderPointQty: string;
  parLevelQty: string;
  valueMinor: number;
  avgCostMinor: number;
  preferredVendor: { id: string; name: string; phone: string | null } | null;
  storageLocation: string | null;
  lastCountedAt: string | null;
  isLow: boolean;
  isOut: boolean;
}

interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  nameI18n: Record<string, string> | null;
  category: string;
  uomId: string;
  buyingRhythm: string;
  avgCostMinor: number;
  shelfLifeDays: number | null;
  isTracked: boolean;
  isActive: boolean;
  notes: string | null;
  uom: { code: string; name: string };
}

interface WorklistGroup {
  vendorId: string | null;
  vendorName: string;
  vendorPhone: string | null;
  estimatedMinor: number;
  items: (OnHandRow & { suggestQty: string })[];
}

interface VarianceRow {
  inventoryItemId: string;
  name: string;
  uom: string;
  purchasedQty: number;
  consumedQty: number;
  declaredWasteQty: number;
  expectedClosingQty: number;
  countedQty: number | null;
  unexplainedQty: number | null;
  unexplainedValueMinor: number | null;
  flagged: boolean;
}

interface StockCount {
  id: string;
  reference: string;
  countedOn: string;
  status: string;
  scope: string | null;
  varianceValueMinor: number;
  _count: { lines: number };
}

type Tab = 'BUY' | 'STOCK' | 'ITEMS' | 'COUNT' | 'VARIANCE';

export default function InventoryPage() {
  return (
    <StaffShell requires="inventory:read" title="Inventory">
      <Inventory />
    </StaffShell>
  );
}

function Inventory() {
  const dict = useDict();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('BUY');

  return (
    <div className="space-y-4">
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'BUY', label: dict.inventory.buyToday },
          { value: 'STOCK', label: 'What I have' },
          { value: 'ITEMS', label: 'Groceries & supplies' },
          { value: 'COUNT', label: 'Stock count' },
          { value: 'VARIANCE', label: dict.reports.variance },
        ]}
      />

      {tab === 'BUY' ? <BuyToday /> : null}
      {tab === 'STOCK' ? <StockTable /> : null}
      {tab === 'ITEMS' ? <Items /> : null}
      {tab === 'COUNT' ? (can('stock:count') ? <StockCounts /> : <Empty>No access</Empty>) : null}
      {tab === 'VARIANCE' ? (can('report:variance') ? <Variance /> : <Empty>No access</Empty>) : null}
    </div>
  );
}

// ─── The item catalogue ──────────────────────────────────────────────────────

/**
 * Groceries, packaging, gas and consumables.
 *
 * The two fields that do the real work are **buying rhythm** and **reorder point**.
 * Rhythm decides which list an item appears on — the 6 am mandi run or the monthly
 * distributor order — and a kitchen that mixes those into one list stops reading it.
 * Reorder point decides when it appears at all.
 */
function Items() {
  const dict = useDict();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<InventoryItem | 'NEW' | null>(null);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: ['inv-catalogue', category, search],
    queryFn: () =>
      get<InventoryItem[]>(
        `/inventory/items?${new URLSearchParams({
          ...(category ? { category } : {}),
          ...(search ? { search } : {}),
        })}`,
      ),
  });

  return (
    <div className="space-y-3">
      <Toolbar>
        {can('inventory:write') ? <Button onClick={() => setEditing('NEW')}>+ Add an item</Button> : null}
        <select
          className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {INVENTORY_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.toLowerCase()}
            </option>
          ))}
        </select>
        <input
          className="ml-auto w-48 rounded-lg border border-ink-200 px-3 py-2 text-sm"
          placeholder={dict.common.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Toolbar>

      <ErrorNote error={query.error} />

      {(query.data?.length ?? 0) === 0 ? (
        <Empty>
          Nothing here. Add items one at a time, or import the whole list from a spreadsheet — that is
          usually faster for the first thirty.
        </Empty>
      ) : (
        <Table
          head={['Item', 'Category', 'Unit', 'Buying rhythm', 'Cost', ...(can('inventory:write') ? [dict.common.actions] : [])]}
        >
          {(query.data ?? []).map((i) => (
            <tr key={i.id} className={i.isActive ? undefined : 'opacity-50'}>
              <td className="px-3 py-2">
                <div className="font-medium">{i.name}</div>
                <div className="text-xs text-ink-400">
                  {i.sku}
                  {i.shelfLifeDays ? ` · keeps ${i.shelfLifeDays}d` : ''}
                </div>
              </td>
              <td className="px-3 py-2 text-ink-600">{i.category.toLowerCase()}</td>
              <td className="px-3 py-2">{i.uom.code}</td>
              <td className="px-3 py-2">
                <RhythmBadge rhythm={i.buyingRhythm} />
              </td>
              <td className="px-3 py-2 tabular-nums">
                {formatMinor(i.avgCostMinor)}
                <span className="text-xs text-ink-400">/{i.uom.code}</span>
              </td>
              {can('inventory:write') ? (
                <td className="px-3 py-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(i)}>
                    {dict.common.edit}
                  </Button>
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      )}

      {editing ? (
        <ItemDialog
          item={editing === 'NEW' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['inv-catalogue'] });
            void queryClient.invalidateQueries({ queryKey: ['inv-items'] });
            void queryClient.invalidateQueries({ queryKey: ['on-hand'] });
          }}
        />
      ) : null}
    </div>
  );
}

function ItemDialog({
  item,
  onClose,
  onDone,
}: {
  item: InventoryItem | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { branchId } = useSession();
  const uoms = useQuery({ queryKey: ['uoms'], queryFn: () => get<{ id: string; code: string; name: string }[]>('/inventory/uoms') });
  const vendors = useQuery({ queryKey: ['vendors', false], queryFn: () => get<{ id: string; name: string }[]>('/vendors') });
  const onHand = useQuery({
    queryKey: ['on-hand', branchId],
    enabled: !!branchId,
    queryFn: () => get<OnHandRow[]>(`/inventory/on-hand/${branchId}`),
  });

  const policy = onHand.data?.find((r) => r.inventoryItemId === item?.id);

  const [form, setForm] = useState({
    sku: item?.sku ?? '',
    name: item?.name ?? '',
    nameHi: item?.nameI18n?.['hi'] ?? '',
    category: item?.category ?? 'PERISHABLE',
    uomId: item?.uomId ?? '',
    buyingRhythm: item?.buyingRhythm ?? 'WEEKLY',
    shelfLifeDays: item?.shelfLifeDays ? String(item.shelfLifeDays) : '',
    isActive: item?.isActive ?? true,
    notes: item?.notes ?? '',
    // Branch-level policy, saved with a second call.
    reorderPointQty: policy?.reorderPointQty ?? '0',
    parLevelQty: policy?.parLevelQty ?? '0',
    preferredVendorId: policy?.preferredVendor?.id ?? '',
    storageLocation: policy?.storageLocation ?? '',
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const [openingQty, setOpeningQty] = useState('');
  const [openingCost, setOpeningCost] = useState(0);

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        sku: form.sku.trim().toUpperCase(),
        name: form.name.trim(),
        nameI18n: form.nameHi.trim() ? { hi: form.nameHi.trim() } : {},
        category: form.category,
        uomId: form.uomId,
        buyingRhythm: form.buyingRhythm,
        shelfLifeDays: form.shelfLifeDays ? Number(form.shelfLifeDays) : undefined,
        isTracked: true,
        isActive: form.isActive,
        notes: form.notes || undefined,
      };
      const saved = item
        ? await put<InventoryItem>(`/inventory/items/${item.id}`, body)
        : await post<InventoryItem>('/inventory/items', body);

      await put('/inventory/policy', {
        branchId,
        inventoryItemId: saved.id,
        reorderPointQty: form.reorderPointQty || '0',
        parLevelQty: form.parLevelQty || '0',
        preferredVendorId: form.preferredVendorId || undefined,
        storageLocation: form.storageLocation || undefined,
      });

      // Opening stock is posted once, on creation. Adding it to an existing item would
      // be a silent stock gain with no purchase behind it.
      if (!item && Number(openingQty) > 0) {
        await post('/inventory/movements', {
          branchId,
          inventoryItemId: saved.id,
          qtyDelta: openingQty,
          reason: 'OPENING_BALANCE',
          note: 'Entered when the item was created',
        });
      }
      return saved;
    },
    onSuccess: onDone,
  });

  const valid = form.sku.trim() && form.name.trim() && form.uomId;

  return (
    <FormDialog
      title={item ? `Edit ${item.name}` : 'Add an item'}
      subtitle="Anything you buy: groceries, packaging, gas, cleaning supplies."
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={!valid}
      wide
    >
      <FormGrid>
        <TextField
          label="Code"
          value={form.sku}
          onChange={(v) => set('sku', v.toUpperCase())}
          hint="Short and unique, e.g. RICE-SONA"
          required
          disabled={!!item}
          autoFocus={!item}
        />
        <TextField label="Name" value={form.name} onChange={(v) => set('name', v)} required />
        <TextField label="Hindi name" value={form.nameHi} onChange={(v) => set('nameHi', v)} hint="Helps kitchen staff" />
        <SelectField
          label="Category"
          value={form.category}
          onChange={(v) => set('category', v)}
          options={INVENTORY_CATEGORIES.map((c) => ({ value: c, label: c.toLowerCase() }))}
        />
        <SelectField
          label="Stock unit"
          value={form.uomId}
          onChange={(v) => set('uomId', v)}
          required
          placeholder="Choose…"
          options={(uoms.data ?? []).map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }))}
          hint="How you buy and count it. Recipes can use a different unit and will convert."
        />
        <SelectField
          label="Buying rhythm"
          value={form.buyingRhythm}
          onChange={(v) => set('buyingRhythm', v)}
          options={BUYING_RHYTHMS.map((r) => ({ value: r, label: r.replace('_', ' ').toLowerCase() }))}
          hint="Decides which purchase list it appears on"
        />
      </FormGrid>

      <FormSection title="When to reorder" hint="Leave both at zero and it will never appear on a buying list.">
        <FormGrid>
          <NumberField
            label="Reorder when below"
            value={form.reorderPointQty}
            onChange={(v) => set('reorderPointQty', v)}
            min={0}
            suffix={uoms.data?.find((u) => u.id === form.uomId)?.code}
          />
          <NumberField
            label="Top up to"
            value={form.parLevelQty}
            onChange={(v) => set('parLevelQty', v)}
            min={0}
            suffix={uoms.data?.find((u) => u.id === form.uomId)?.code}
            hint="The buy list suggests the difference"
          />
          <SelectField
            label="Usually bought from"
            value={form.preferredVendorId}
            onChange={(v) => set('preferredVendorId', v)}
            placeholder="No preference"
            options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
            hint="Groups this on the buying list"
          />
          <TextField label="Stored where" value={form.storageLocation} onChange={(v) => set('storageLocation', v)} placeholder="Dry store, fridge…" />
          <NumberField
            label="Shelf life"
            value={form.shelfLifeDays}
            onChange={(v) => set('shelfLifeDays', v)}
            min={1}
            suffix="days"
            hint="For perishables"
          />
        </FormGrid>
      </FormSection>

      {!item ? (
        <FormSection title="Opening stock" hint="What is already in the store right now. Entered once.">
          <FormGrid>
            <NumberField label="Quantity on hand" value={openingQty} onChange={setOpeningQty} min={0} />
            <MoneyField label="Cost per unit" minor={openingCost} onChange={setOpeningCost} />
          </FormGrid>
        </FormSection>
      ) : null}

      <FullWidth>
        <CheckField
          label="Active"
          checked={form.isActive}
          onChange={(v) => set('isActive', v)}
          hint="Inactive items stay on past purchases and recipes but disappear from the pickers."
        />
      </FullWidth>
    </FormDialog>
  );
}

// ─── Buy today ───────────────────────────────────────────────────────────────

function BuyToday() {
  const dict = useDict();
  const { branchId } = useSession();
  const [rhythm, setRhythm] = useState('DAILY');

  const query = useQuery({
    queryKey: ['worklist', branchId, rhythm],
    enabled: !!branchId,
    queryFn: () => get<WorklistGroup[]>(`/inventory/buy-today/${branchId}?rhythm=${rhythm}`),
  });

  const rhythms: [string, string][] = [
    ['DAILY', dict.inventory.rhythmDaily],
    ['WEEKLY', dict.inventory.rhythmWeekly],
    ['MONTHLY', dict.inventory.rhythmMonthly],
    ['AS_NEEDED', dict.inventory.rhythmAsNeeded],
    ['DAILY,WEEKLY,FORTNIGHTLY,MONTHLY,AS_NEEDED', dict.common.all],
  ];

  return (
    <div className="space-y-4">
      <Toolbar>
        {rhythms.map(([value, label]) => (
          <button
            key={value}
            onClick={() => setRhythm(value)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              rhythm === value ? 'bg-ink-800 text-white' : 'border border-ink-200 bg-white text-ink-600'
            }`}
          >
            {label}
          </button>
        ))}
      </Toolbar>

      <ErrorNote error={query.error} />

      {(query.data?.length ?? 0) === 0 ? (
        <Empty>
          Nothing below its reorder point for this rhythm. If this is always empty, the items probably have
          no reorder point set — that is on the Groceries tab.
        </Empty>
      ) : (
        (query.data ?? []).map((group) => (
          <Card key={group.vendorId ?? 'none'}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium">{group.vendorName}</h2>
              <span className="text-sm text-ink-600">
                ≈ <span className="font-medium tabular-nums">{formatMinor(group.estimatedMinor)}</span>
              </span>
            </div>
            {group.vendorPhone ? (
              <a className="text-sm text-brand-700 underline" href={`tel:${group.vendorPhone}`}>
                {group.vendorPhone}
              </a>
            ) : null}
            <Table head={['Item', 'Have', 'Top up to', 'Buy']}>
              {group.items.map((i) => (
                <tr key={i.inventoryItemId}>
                  <td className="px-3 py-2">
                    {i.name}{' '}
                    {i.isOut ? <Badge tone="bad">out</Badge> : <Badge tone="warn">low</Badge>}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {Number(i.onHandQty).toFixed(2)} {i.uom}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-ink-400">{Number(i.parLevelQty).toFixed(2)}</td>
                  <td className="px-3 py-2 font-semibold tabular-nums">
                    {Number(i.suggestQty).toFixed(2)} {i.uom}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        ))
      )}
    </div>
  );
}

// ─── What I have ─────────────────────────────────────────────────────────────

function StockTable() {
  const dict = useDict();
  const { branchId, can } = useSession();
  const queryClient = useQueryClient();
  const [wastageFor, setWastageFor] = useState<OnHandRow | null>(null);

  const query = useQuery({
    queryKey: ['on-hand', branchId],
    enabled: !!branchId,
    queryFn: () => get<OnHandRow[]>(`/inventory/on-hand/${branchId}`),
  });

  const totalValue = (query.data ?? []).reduce((s, r) => s + r.valueMinor, 0);

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-600">
        {query.data?.length ?? 0} items
        {can('inventory:cost:read') ? (
          <>
            {' · '}
            <span className="font-medium tabular-nums">{formatMinor(totalValue)}</span> at cost
          </>
        ) : null}
      </p>

      <ErrorNote error={query.error} />

      <Table
        head={[
          'Item',
          dict.inventory.onHand,
          dict.inventory.reorderPoint,
          ...(can('inventory:cost:read') ? ['Cost', 'Value'] : []),
          'Vendor',
          ...(can('stock:wastage') ? [dict.common.actions] : []),
        ]}
      >
        {(query.data ?? []).map((r) => (
          <tr key={r.inventoryItemId} className={r.isOut ? 'bg-red-50' : r.isLow ? 'bg-amber-50' : undefined}>
            <td className="px-3 py-2">
              <div className="font-medium">{r.name}</div>
              <div className="text-xs text-ink-400">
                {r.sku} · {r.category.toLowerCase()}
              </div>
            </td>
            <td className="px-3 py-2 tabular-nums">
              {Number(r.onHandQty).toFixed(3)} {r.uom}
            </td>
            <td className="px-3 py-2 tabular-nums text-ink-400">{Number(r.reorderPointQty).toFixed(2)}</td>
            {can('inventory:cost:read') ? (
              <>
                <td className="px-3 py-2 tabular-nums">{formatMinor(r.avgCostMinor)}</td>
                <td className="px-3 py-2 tabular-nums">{formatMinor(r.valueMinor)}</td>
              </>
            ) : null}
            <td className="px-3 py-2 text-ink-600">{r.preferredVendor?.name ?? '—'}</td>
            {can('stock:wastage') ? (
              <td className="px-3 py-2">
                <Button size="sm" variant="secondary" onClick={() => setWastageFor(r)}>
                  Log wastage
                </Button>
              </td>
            ) : null}
          </tr>
        ))}
      </Table>

      {wastageFor ? (
        <WastageDialog
          item={wastageFor}
          onClose={() => setWastageFor(null)}
          onDone={() => {
            setWastageFor(null);
            void queryClient.invalidateQueries({ queryKey: ['on-hand', branchId] });
          }}
        />
      ) : null}
    </div>
  );
}

function WastageDialog({ item, onClose, onDone }: { item: OnHandRow; onClose: () => void; onDone: () => void }) {
  const { branchId } = useSession();
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('SPOILAGE');
  const [note, setNote] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      post('/inventory/movements', {
        branchId,
        inventoryItemId: item.inventoryItemId,
        qtyDelta: `-${Math.abs(Number(qty))}`,
        reason,
        note: note || undefined,
      }),
    onSuccess: onDone,
  });

  return (
    <FormDialog
      title={item.name}
      subtitle={`${Number(item.onHandQty).toFixed(3)} ${item.uom} on hand`}
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={!qty || Number(qty) <= 0}
    >
      <NumberField label="How much" value={qty} onChange={setQty} min={0} step="0.001" suffix={item.uom} />
      <SelectField
        label="What happened"
        value={reason}
        onChange={setReason}
        options={[
          { value: 'SPOILAGE', label: 'Spoiled / went bad' },
          { value: 'WASTAGE', label: 'Prepared but not sold' },
          { value: 'STAFF_MEAL', label: 'Staff meal' },
        ]}
      />
      <TextField label="Note" value={note} onChange={setNote} />
      <p className="text-xs text-ink-400">
        Logging this protects the staff: unlogged wastage is indistinguishable from theft in the variance
        report.
      </p>
    </FormDialog>
  );
}

// ─── Stock count ─────────────────────────────────────────────────────────────

/**
 * Physical stock take.
 *
 * Counting is what closes the loop: the ledger says what should be there, this says what
 * is. Approving a count posts the difference as an adjustment, so the ledger and reality
 * agree again and the next period's variance starts from a known point.
 */
function StockCounts() {
  const dict = useDict();
  const { branchId, can } = useSession();
  const queryClient = useQueryClient();
  const [counting, setCounting] = useState(false);

  const counts = useQuery({
    queryKey: ['stock-counts', branchId],
    enabled: !!branchId,
    queryFn: () => get<StockCount[]>(`/inventory/counts/${branchId}`),
  });

  const approve = useMutation({
    mutationFn: (id: string) => post(`/inventory/counts/${id}/approve`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stock-counts', branchId] });
      void queryClient.invalidateQueries({ queryKey: ['on-hand', branchId] });
    },
  });

  return (
    <div className="space-y-3">
      <Toolbar>
        <Button onClick={() => setCounting(true)}>+ New stock count</Button>
        <span className="text-sm text-ink-400">
          Count the perishables weekly and everything monthly. Approving posts the difference to the ledger.
        </span>
      </Toolbar>

      <ErrorNote error={counts.error} />
      <ErrorNote error={approve.error} />

      {(counts.data?.length ?? 0) === 0 ? (
        <Empty>No counts yet. The variance report has nothing to compare against until you do one.</Empty>
      ) : (
        <Table head={['Reference', dict.common.date, 'Scope', 'Lines', 'Variance value', dict.common.status, dict.common.actions]}>
          {(counts.data ?? []).map((c) => (
            <tr key={c.id}>
              <td className="px-3 py-2 font-medium">{c.reference}</td>
              <td className="px-3 py-2 tabular-nums">{c.countedOn.slice(0, 10)}</td>
              <td className="px-3 py-2">{c.scope ?? 'all'}</td>
              <td className="px-3 py-2 tabular-nums">{c._count.lines}</td>
              <td className={`px-3 py-2 tabular-nums ${c.varianceValueMinor < 0 ? 'text-red-600' : ''}`}>
                {formatMinor(c.varianceValueMinor)}
              </td>
              <td className="px-3 py-2">
                <Badge tone={c.status === 'APPROVED' ? 'good' : 'warn'}>{c.status.toLowerCase()}</Badge>
              </td>
              <td className="px-3 py-2">
                {c.status === 'SUBMITTED' && can('stock:count:approve') ? (
                  <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(c.id)}>
                    Approve
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      )}

      {counting ? (
        <CountDialog
          onClose={() => setCounting(false)}
          onDone={() => {
            setCounting(false);
            void queryClient.invalidateQueries({ queryKey: ['stock-counts', branchId] });
          }}
        />
      ) : null}
    </div>
  );
}

function CountDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { branchId } = useSession();
  const [countedOn, setCountedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [scope, setScope] = useState('');
  const [counted, setCounted] = useState<Record<string, string>>({});

  const onHand = useQuery({
    queryKey: ['on-hand', branchId],
    enabled: !!branchId,
    queryFn: () => get<OnHandRow[]>(`/inventory/on-hand/${branchId}`),
  });

  const rows = (onHand.data ?? []).filter((r) => !scope || r.category === scope);

  const mutation = useMutation({
    mutationFn: () =>
      post('/inventory/counts', {
        branchId,
        countedOn,
        scope: scope || undefined,
        lines: Object.entries(counted)
          .filter(([, v]) => v !== '')
          .map(([inventoryItemId, countedQty]) => ({ inventoryItemId, countedQty })),
      }),
    onSuccess: onDone,
  });

  const entered = Object.values(counted).filter((v) => v !== '').length;

  return (
    <FormDialog
      title="Stock count"
      subtitle="Enter what you physically counted. Leave a row blank to skip it."
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={entered === 0}
      submitLabel={`Submit ${entered} counted`}
      wide
    >
      <FormGrid>
        <TextField label="Counted on" value={countedOn} onChange={setCountedOn} type="date" />
        <SelectField
          label="Counting what"
          value={scope}
          onChange={setScope}
          placeholder="Everything"
          options={INVENTORY_CATEGORIES.map((c) => ({ value: c, label: c.toLowerCase() }))}
          hint="Counting one category at a time is far more likely to get finished"
        />
      </FormGrid>

      <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-ink-100 p-2">
        {rows.map((r) => (
          <div key={r.inventoryItemId} className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 text-sm">
            <span className="truncate">{r.name}</span>
            <span className="text-right tabular-nums text-ink-400">
              {Number(r.onHandQty).toFixed(2)} {r.uom}
            </span>
            <input
              className="w-full rounded border border-ink-200 px-2 py-1 text-right tabular-nums"
              type="number"
              step="0.001"
              placeholder="count"
              value={counted[r.inventoryItemId] ?? ''}
              onChange={(e) => setCounted((c) => ({ ...c, [r.inventoryItemId]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <p className="text-xs text-ink-400">
        The middle column is what the system thinks you have. Count first, then look — reading it beforehand
        is how a count becomes a formality.
      </p>
    </FormDialog>
  );
}

// ─── Variance ────────────────────────────────────────────────────────────────

function Variance() {
  const dict = useDict();
  const { branchId } = useSession();
  const [from, setFrom] = useState(() => new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const query = useQuery({
    queryKey: ['variance', branchId, from, to],
    enabled: !!branchId,
    queryFn: () => get<VarianceRow[]>(`/inventory/variance/${branchId}?from=${from}&to=${to}`),
  });

  const flagged = (query.data ?? []).filter((r) => r.flagged);

  return (
    <div className="space-y-3">
      <Toolbar>
        <TextField label={dict.common.from} value={from} onChange={setFrom} type="date" />
        <TextField label={dict.common.to} value={to} onChange={setTo} type="date" />
      </Toolbar>

      <ErrorNote error={query.error} />

      {flagged.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {flagged.length} item{flagged.length === 1 ? '' : 's'} with more than 5% unaccounted for. Count them
          physically before drawing any conclusion — a missing recipe looks exactly like theft here.
        </div>
      ) : null}

      <Table head={['Item', 'Bought', 'Should have used', 'Wasted', 'Expected', 'Counted', 'Unexplained']}>
        {(query.data ?? []).map((r) => (
          <tr key={r.inventoryItemId} className={r.flagged ? 'bg-amber-50' : undefined}>
            <td className="px-3 py-2">{r.name}</td>
            <td className="px-3 py-2 tabular-nums">{r.purchasedQty.toFixed(2)}</td>
            <td className="px-3 py-2 tabular-nums">{r.consumedQty.toFixed(2)}</td>
            <td className="px-3 py-2 tabular-nums">{r.declaredWasteQty.toFixed(2)}</td>
            <td className="px-3 py-2 tabular-nums text-ink-400">{r.expectedClosingQty.toFixed(2)}</td>
            <td className="px-3 py-2 tabular-nums">{r.countedQty === null ? '—' : r.countedQty.toFixed(2)}</td>
            <td className={`px-3 py-2 font-medium tabular-nums ${r.unexplainedQty && r.unexplainedQty < 0 ? 'text-red-600' : ''}`}>
              {r.unexplainedQty === null ? '—' : r.unexplainedQty.toFixed(3)}
              {r.unexplainedValueMinor !== null ? (
                <span className="ml-1 text-xs text-ink-400">({formatMinor(r.unexplainedValueMinor)})</span>
              ) : null}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function RhythmBadge({ rhythm }: { rhythm: string }) {
  const tone = rhythm === 'DAILY' ? 'bad' : rhythm === 'WEEKLY' ? 'warn' : 'neutral';
  return <Badge tone={tone as 'bad' | 'warn' | 'neutral'}>{rhythm.replace('_', ' ').toLowerCase()}</Badge>;
}
