'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formatMinor } from '@mk/shared';
import { Badge, Button, Card, Empty, ErrorNote, Field, Table, inputClass } from '@/components/ui';
import { StaffShell } from '@/components/staff-shell';
import { get, post } from '@/lib/api';
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
  isLow: boolean;
  isOut: boolean;
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

export default function InventoryPage() {
  return (
    <StaffShell requires="inventory:read" title="Inventory">
      <Inventory />
    </StaffShell>
  );
}

function Inventory() {
  const dict = useDict();
  const { branchId, can } = useSession();
  const [tab, setTab] = useState<'BUY' | 'STOCK' | 'VARIANCE'>('BUY');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['BUY', dict.inventory.buyToday],
            ['STOCK', dict.inventory.onHand],
            ['VARIANCE', dict.reports.variance],
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

      {tab === 'BUY' ? <BuyToday /> : null}
      {tab === 'STOCK' ? <StockTable canWaste={can('stock:wastage')} /> : null}
      {tab === 'VARIANCE' ? (can('report:variance') ? <Variance /> : <Empty>{dict.auth.noAccess}</Empty>) : null}
    </div>
  );
}

/**
 * The morning purchase list.
 *
 * Filtered by buying rhythm and grouped by vendor, because a kitchen does not have one
 * purchasing workflow: the daily-fresh list is read out loud at the mandi at 6 am, the
 * monthly spice order is a PO emailed to a distributor. A single undifferentiated list of
 * 80 items is a list nobody opens.
 */
function BuyToday() {
  const dict = useDict();
  const { branchId } = useSession();
  const [rhythm, setRhythm] = useState<string>('DAILY');

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
      <div className="flex flex-wrap gap-2">
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
      </div>

      <ErrorNote error={query.error} />

      {(query.data?.length ?? 0) === 0 ? (
        <Empty>Nothing below its reorder point for this buying rhythm.</Empty>
      ) : (
        (query.data ?? []).map((group) => (
          <Card key={group.vendorId ?? 'none'}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium">{group.vendorName}</h2>
              <span className="text-sm text-ink-600">
                ≈ <span className="tabular-nums font-medium">{formatMinor(group.estimatedMinor)}</span>
              </span>
            </div>
            {group.vendorPhone ? (
              <a className="text-sm text-brand-700 underline" href={`tel:${group.vendorPhone}`}>
                {group.vendorPhone}
              </a>
            ) : null}
            <Table head={[dict.common.name, dict.inventory.onHand, dict.inventory.parLevel, 'Buy']}>
              {group.items.map((i) => (
                <tr key={i.inventoryItemId}>
                  <td className="px-3 py-2">
                    {i.name}
                    {i.isOut ? (
                      <Badge tone="bad">{dict.inventory.outOfStock}</Badge>
                    ) : (
                      <span className="ml-2">
                        <Badge tone="warn">{dict.inventory.lowStock}</Badge>
                      </span>
                    )}
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

function StockTable({ canWaste }: { canWaste: boolean }) {
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
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-ink-600">
          {query.data?.length ?? 0} items
          {can('inventory:cost:read') ? (
            <>
              {' · '}
              <span className="font-medium tabular-nums">{formatMinor(totalValue)}</span> at cost
            </>
          ) : null}
        </p>
      </div>

      <ErrorNote error={query.error} />

      <Table
        head={[
          dict.common.name,
          dict.inventory.onHand,
          dict.inventory.reorderPoint,
          ...(can('inventory:cost:read') ? ['Cost', 'Value'] : []),
          dict.vendors.balance.replace('Outstanding', 'Vendor'),
          ...(canWaste ? [dict.common.actions] : []),
        ]}
      >
        {(query.data ?? []).map((r) => (
          <tr key={r.inventoryItemId} className={r.isOut ? 'bg-red-50' : r.isLow ? 'bg-amber-50' : undefined}>
            <td className="px-3 py-2">
              <div className="font-medium">{r.name}</div>
              <div className="text-xs text-ink-400">
                {r.sku} · {r.category} · {r.buyingRhythm.replace('_', ' ').toLowerCase()}
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
            {canWaste ? (
              <td className="px-3 py-2">
                <Button size="sm" variant="secondary" onClick={() => setWastageFor(r)}>
                  {dict.inventory.logWastage}
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

/**
 * Wastage entry.
 *
 * Deliberately easy to reach and deliberately requires a reason. Unlogged wastage is
 * indistinguishable from theft in the variance report, which means every undeclared
 * spoiled crate of tomatoes casts suspicion on the staff. Making this the path of least
 * resistance protects them.
 */
function WastageDialog({ item, onClose, onDone }: { item: OnHandRow; onClose: () => void; onDone: () => void }) {
  const dict = useDict();
  const { branchId } = useSession();
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState<'WASTAGE' | 'SPOILAGE' | 'STAFF_MEAL'>('SPOILAGE');
  const [note, setNote] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      post('/inventory/movements', {
        branchId,
        inventoryItemId: item.inventoryItemId,
        // Negative: this is stock leaving.
        qtyDelta: `-${Math.abs(Number(qty))}`,
        reason,
        note: note || undefined,
      }),
    onSuccess: onDone,
  });

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink-900/50 p-4">
      <Card className="w-full max-w-sm">
        <h2 className="font-display text-lg font-semibold">{item.name}</h2>
        <p className="text-sm text-ink-400">
          {dict.inventory.onHand}: {Number(item.onHandQty).toFixed(3)} {item.uom}
        </p>

        <div className="mt-4 space-y-3">
          <Field label={`${dict.common.qty} (${item.uom})`}>
            <input className={inputClass} type="number" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
          </Field>
          <Field label="Reason">
            <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
              <option value="SPOILAGE">Spoiled / went bad</option>
              <option value="WASTAGE">Prepared but not sold</option>
              <option value="STAFF_MEAL">Staff meal</option>
            </select>
          </Field>
          <Field label={dict.common.notes}>
            <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <ErrorNote error={mutation.error} />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={onClose}>
              {dict.common.cancel}
            </Button>
            <Button disabled={!qty || mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? dict.common.saving : dict.common.save}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/**
 * The variance report — module 4.
 *
 * Purchased, minus what the recipes say should have been used, minus declared wastage,
 * compared against a physical count. What is left over is unexplained, and unexplained
 * paneer is a different conversation from unexplained tomatoes.
 */
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
      <div className="flex flex-wrap items-end gap-2">
        <Field label={dict.common.from}>
          <input className={inputClass} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={dict.common.to}>
          <input className={inputClass} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>

      <ErrorNote error={query.error} />

      {flagged.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {flagged.length} item{flagged.length === 1 ? '' : 's'} with more than 5% unaccounted for. Count these
          physically before drawing any conclusion — a missing recipe looks exactly like theft in this report.
        </div>
      ) : null}

      <Table
        head={[
          dict.common.name,
          dict.reports.purchased,
          dict.reports.consumed,
          dict.reports.wastage,
          'Expected',
          dict.reports.counted,
          'Unexplained',
        ]}
      >
        {(query.data ?? []).map((r) => (
          <tr key={r.inventoryItemId} className={r.flagged ? 'bg-amber-50' : undefined}>
            <td className="px-3 py-2">{r.name}</td>
            <td className="px-3 py-2 tabular-nums">{r.purchasedQty.toFixed(2)}</td>
            <td className="px-3 py-2 tabular-nums">{r.consumedQty.toFixed(2)}</td>
            <td className="px-3 py-2 tabular-nums">{r.declaredWasteQty.toFixed(2)}</td>
            <td className="px-3 py-2 tabular-nums text-ink-400">{r.expectedClosingQty.toFixed(2)}</td>
            <td className="px-3 py-2 tabular-nums">{r.countedQty === null ? '—' : r.countedQty.toFixed(2)}</td>
            <td className={`px-3 py-2 tabular-nums font-medium ${r.unexplainedQty && r.unexplainedQty < 0 ? 'text-red-600' : ''}`}>
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
