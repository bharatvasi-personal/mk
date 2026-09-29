'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formatMinor } from '@mk/shared';
import { Badge, Button, Card, Empty, ErrorNote, Field, Table, inputClass } from '@/components/ui';
import { StaffShell } from '@/components/staff-shell';
import { get, post } from '@/lib/api';
import { useDict } from '@/lib/dict';
import { useSession } from '@/lib/session';

interface Vendor {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  category: string | null;
  creditDays: number;
  upiId: string | null;
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
  const [tab, setTab] = useState<'PAYABLES' | 'RECEIVE' | 'VENDORS'>('PAYABLES');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['PAYABLES', dict.vendors.balance],
            ['RECEIVE', dict.inventory.receiveStock],
            ['VENDORS', dict.admin.vendors],
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

      {tab === 'PAYABLES' ? <Payables canPay={can('payable:pay')} /> : null}
      {tab === 'RECEIVE' ? (can('grn:create') ? <ReceiveGoods /> : <Empty>{dict.auth.noAccess}</Empty>) : null}
      {tab === 'VENDORS' ? <Vendors /> : null}
    </div>
  );
}

/**
 * Payables, overdue first.
 *
 * These suppliers extend 7–15 days of credit on a handshake, and the relationship is
 * worth more than the float. This screen exists so it is never lost over a forgotten
 * ₹4,000 bill — the single most common way a small kitchen damages its supply line.
 */
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
          {dict.vendors.balance}: <strong className="tabular-nums">{formatMinor(total)}</strong>
        </span>
        {overdue > 0 ? (
          <span className="text-red-600">
            {dict.vendors.overdue}: <strong className="tabular-nums">{formatMinor(overdue)}</strong>
          </span>
        ) : null}
      </div>

      <ErrorNote error={query.error} />

      {(query.data?.length ?? 0) === 0 ? (
        <Empty>Nothing outstanding.</Empty>
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
              <td className="px-3 py-2 tabular-nums font-medium">{formatMinor(p.outstandingMinor)}</td>
              <td className="px-3 py-2">
                <Badge tone={p.isOverdue ? 'bad' : p.status === 'PARTIALLY_PAID' ? 'warn' : 'neutral'}>
                  {p.status.replace('_', ' ').toLowerCase()}
                </Badge>
              </td>
              {canPay ? (
                <td className="px-3 py-2">
                  <Button size="sm" onClick={() => setPaying(p)}>
                    {dict.vendors.recordPayment}
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
  const dict = useDict();
  const [amount, setAmount] = useState(payable.outstandingMinor);
  const [method, setMethod] = useState<'CASH' | 'UPI' | 'NEFT' | 'IMPS' | 'CHEQUE'>('UPI');
  const [reference, setReference] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      post('/vendors/payments', {
        vendorId: payable.vendor.id,
        amountMinor: amount,
        method,
        reference: reference || undefined,
        // Allocated explicitly to this bill; leaving it empty would apply oldest-first.
        allocations: [{ vendorInvoiceId: payable.id, amountMinor: amount }],
      }),
    onSuccess: onDone,
  });

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink-900/50 p-4">
      <Card className="w-full max-w-sm">
        <h2 className="font-display text-lg font-semibold">{payable.vendor.name}</h2>
        <p className="text-sm text-ink-400">
          {payable.billNo} · {dict.vendors.balance} {formatMinor(payable.outstandingMinor)}
        </p>
        {payable.vendor.upiId ? <p className="mt-1 text-xs text-ink-600">UPI: {payable.vendor.upiId}</p> : null}

        <div className="mt-4 space-y-3">
          <Field label={dict.common.amount}>
            <input
              className={`${inputClass} text-right`}
              type="number"
              value={amount / 100}
              onChange={(e) => setAmount(Math.round(Number(e.target.value) * 100))}
            />
          </Field>
          <Field label="Method">
            <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              {['UPI', 'CASH', 'NEFT', 'IMPS', 'CHEQUE'].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reference" hint="UTR / cheque number — needed to match the bank statement">
            <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <ErrorNote error={mutation.error} />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={onClose}>
              {dict.common.cancel}
            </Button>
            <Button disabled={amount <= 0 || mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? dict.common.saving : dict.common.confirm}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/**
 * Goods receipt.
 *
 * A separate document from the purchase order, because at a mandi you order 10 kg of
 * tomatoes and 8.4 kg arrive, late, in two deliveries, with one crate rejected. Receiving
 * here updates stock *and* the weighted-average cost, which is why the food-cost
 * percentage moves the day onion prices move rather than at month end.
 */
function ReceiveGoods() {
  const dict = useDict();
  const { branchId } = useSession();
  const queryClient = useQueryClient();
  const [vendorId, setVendorId] = useState('');
  const [billNo, setBillNo] = useState('');
  const [lines, setLines] = useState<{ inventoryItemId: string; receivedQty: string; unitPriceMinor: number }[]>([]);
  const [done, setDone] = useState<string | null>(null);

  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => get<Vendor[]>('/vendors') });
  const items = useQuery({ queryKey: ['inv-items'], queryFn: () => get<InventoryItem[]>('/inventory/items') });

  const mutation = useMutation({
    mutationFn: () =>
      post<{ receipt: { reference: string } }>('/vendors/receipts', {
        branchId,
        vendorId,
        billNo: billNo || undefined,
        billDate: billNo ? new Date().toISOString().slice(0, 10) : undefined,
        lines: lines.map((l) => ({ ...l, rejectedQty: '0' })),
      }),
    onSuccess: (res) => {
      setDone(res.receipt.reference);
      setLines([]);
      setBillNo('');
      void queryClient.invalidateQueries({ queryKey: ['on-hand', branchId] });
      void queryClient.invalidateQueries({ queryKey: ['payables'] });
    },
  });

  const total = lines.reduce((s, l) => s + Number(l.receivedQty || 0) * l.unitPriceMinor, 0);

  return (
    <Card>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={dict.admin.vendors}>
          <select className={inputClass} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">—</option>
            {(vendors.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.creditDays}d credit)
              </option>
            ))}
          </select>
        </Field>
        <Field label="Vendor bill number" hint="Optional — attach it later if the bill follows the delivery">
          <input className={inputClass} value={billNo} onChange={(e) => setBillNo(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4 space-y-2">
        {lines.map((line, index) => (
          <div key={index} className="grid grid-cols-[1fr_6rem_7rem_2.5rem] items-end gap-2">
            <select
              className={inputClass}
              value={line.inventoryItemId}
              onChange={(e) => {
                const item = items.data?.find((i) => i.id === e.target.value);
                setLines((ls) =>
                  ls.map((l, i) =>
                    i === index
                      ? { ...l, inventoryItemId: e.target.value, unitPriceMinor: item?.avgCostMinor ?? l.unitPriceMinor }
                      : l,
                  ),
                );
              }}
            >
              <option value="">—</option>
              {(items.data ?? []).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.uom.code})
                </option>
              ))}
            </select>
            <input
              className={inputClass}
              type="number"
              step="0.001"
              placeholder={dict.common.qty}
              value={line.receivedQty}
              onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, receivedQty: e.target.value } : l)))}
            />
            <input
              className={inputClass}
              type="number"
              step="0.01"
              placeholder="Rate ₹"
              value={line.unitPriceMinor / 100}
              onChange={(e) =>
                setLines((ls) =>
                  ls.map((l, i) => (i === index ? { ...l, unitPriceMinor: Math.round(Number(e.target.value) * 100) } : l)),
                )
              }
            />
            <Button variant="ghost" onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))}>
              ✕
            </Button>
          </div>
        ))}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setLines((ls) => [...ls, { inventoryItemId: '', receivedQty: '', unitPriceMinor: 0 }])}
        >
          + {dict.common.add}
        </Button>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-ink-100 pt-3">
        <span className="text-sm text-ink-600">
          {dict.common.total}: <strong className="tabular-nums">{formatMinor(total)}</strong>
        </span>
        <Button
          disabled={!vendorId || lines.length === 0 || lines.some((l) => !l.inventoryItemId || !l.receivedQty) || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? dict.common.saving : dict.inventory.receiveStock}
        </Button>
      </div>

      <ErrorNote error={mutation.error} />
      {done ? <p className="mt-2 text-sm text-leaf-600">Received · {done}</p> : null}
    </Card>
  );
}

function Vendors() {
  const dict = useDict();
  const query = useQuery({ queryKey: ['vendors'], queryFn: () => get<Vendor[]>('/vendors') });

  return (
    <Table head={[dict.common.name, 'Category', dict.common.phone, dict.vendors.creditDays, 'UPI']}>
      {(query.data ?? []).map((v) => (
        <tr key={v.id}>
          <td className="px-3 py-2">
            <div className="font-medium">{v.name}</div>
            <div className="text-xs text-ink-400">{v.code}</div>
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
          <td className="px-3 py-2 tabular-nums">{v.creditDays}</td>
          <td className="px-3 py-2 text-xs">{v.upiId ?? '—'}</td>
        </tr>
      ))}
    </Table>
  );
}
