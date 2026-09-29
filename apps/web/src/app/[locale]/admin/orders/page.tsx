'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ORDER_CHANNELS, ORDER_STATUSES, formatMinor } from '@mk/shared';
import { Badge, Button, Card, Empty, ErrorNote, Table } from '@/components/ui';
import { FormDialog, MoneyField, SelectField, TextField, Toolbar } from '@/components/admin/form';
import { StaffShell } from '@/components/staff-shell';
import { get, post } from '@/lib/api';
import { useDict } from '@/lib/dict';
import { useSession } from '@/lib/session';
import { printBill, renderThermalBill, type BillPayload } from '@/lib/print';

interface OrderRow {
  id: string;
  tokenNo: number;
  channel: string;
  status: string;
  paymentStatus: string;
  mealSlot: string;
  customerName: string | null;
  customerPhone: string | null;
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  costMinor: number;
  createdAt: string;
  settledAt: string | null;
  items: { nameSnapshot: string; variantSnapshot: string; qty: number }[];
  payments: { tender: string; amountMinor: number; reference: string | null }[];
  invoice: { invoiceNo: string } | null;
  table: { label: string } | null;
  creditNotes: { id: string; noteNo: string; amountMinor: number; reason: string }[];
}

export default function OrdersPage() {
  return (
    <StaffShell requires="order:read" title="Bills">
      <Orders />
    </StaffShell>
  );
}

/**
 * Bill history.
 *
 * Needed far more often than it sounds: a customer comes back about a wrong charge, a
 * partner wants to know what a ₹2,400 table actually ate, the accountant is matching a
 * UPI statement. Search takes a token number, an invoice number, a phone or a name —
 * because those are the four things someone actually has when they ask.
 */
function Orders() {
  const dict = useDict();
  const { branchId, can } = useSession();
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [crediting, setCrediting] = useState<OrderRow | null>(null);

  const query = useQuery({
    queryKey: ['orders-history', branchId, from, to, status, channel, search, page],
    enabled: !!branchId,
    queryFn: () =>
      get<{ total: number; rows: OrderRow[]; pageSize: number }>(
        `/orders/history?${new URLSearchParams({
          branchId: branchId!,
          from,
          to,
          ...(status ? { status } : {}),
          ...(channel ? { channel } : {}),
          ...(search ? { search } : {}),
          page: String(page),
        })}`,
      ),
  });

  const rows = query.data?.rows ?? [];
  const pages = Math.ceil((query.data?.total ?? 0) / (query.data?.pageSize ?? 25));
  const settled = rows.filter((r) => r.status === 'SETTLED');
  const takings = settled.reduce((s, r) => s + r.totalMinor, 0);

  async function reprint(id: string) {
    const bill = await get<BillPayload>(`/orders/${id}/bill`);
    printBill(renderThermalBill(bill, { copy: 'DUPLICATE' }));
  }

  return (
    <div className="space-y-3">
      <Toolbar>
        <TextField label={dict.common.from} value={from} onChange={setFrom} type="date" />
        <TextField label={dict.common.to} value={to} onChange={setTo} type="date" />
        <SelectField
          label={dict.common.status}
          value={status}
          onChange={setStatus}
          placeholder="Any"
          options={ORDER_STATUSES.map((s) => ({ value: s, label: s.toLowerCase() }))}
        />
        <SelectField
          label="Type"
          value={channel}
          onChange={setChannel}
          placeholder="Any"
          options={ORDER_CHANNELS.map((c) => ({ value: c, label: c.replace('_', ' ').toLowerCase() }))}
        />
        <div className="ml-auto">
          <TextField
            label="Find"
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Token, bill no, phone…"
          />
        </div>
      </Toolbar>

      <p className="text-sm text-ink-600">
        {query.data?.total ?? 0} bills · {settled.length} settled on this page ·{' '}
        <span className="font-medium tabular-nums">{formatMinor(takings)}</span>
      </p>

      <ErrorNote error={query.error} />

      {rows.length === 0 ? (
        <Empty>No bills in this range.</Empty>
      ) : (
        <Table
          head={[
            'Token',
            'When',
            'What',
            'Paid by',
            dict.common.total,
            dict.common.status,
            ...(can('order:read') ? [dict.common.actions] : []),
          ]}
        >
          {rows.map((o) => (
            <tr key={o.id} className={o.status === 'CANCELLED' ? 'opacity-50' : undefined}>
              <td className="px-3 py-2">
                <div className="text-lg font-bold tabular-nums">{o.tokenNo}</div>
                <div className="text-xs text-ink-400">{o.invoice?.invoiceNo ?? 'not billed'}</div>
              </td>
              <td className="px-3 py-2">
                <div className="tabular-nums">
                  {new Date(o.settledAt ?? o.createdAt).toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </div>
                <div className="text-xs text-ink-400">
                  {o.table ? `Table ${o.table.label}` : o.channel.replace('_', ' ').toLowerCase()}
                  {o.customerPhone ? ` · ${o.customerPhone}` : ''}
                </div>
              </td>
              <td className="px-3 py-2">
                {o.items.slice(0, 3).map((i, n) => (
                  <div key={n} className="text-xs">
                    {i.qty}× {i.nameSnapshot}
                    {i.variantSnapshot !== 'Regular' ? ` (${i.variantSnapshot})` : ''}
                  </div>
                ))}
                {o.items.length > 3 ? (
                  <div className="text-xs text-ink-400">+{o.items.length - 3} more</div>
                ) : null}
              </td>
              <td className="px-3 py-2">
                {o.payments.map((p, n) => (
                  <div key={n} className="text-xs">
                    {p.tender.replace('_', ' ').toLowerCase()} {formatMinor(p.amountMinor)}
                    {p.reference ? <div className="text-ink-400">{p.reference}</div> : null}
                  </div>
                ))}
                {o.payments.length === 0 ? <span className="text-xs text-ink-400">unpaid</span> : null}
              </td>
              <td className="px-3 py-2">
                <div className="font-medium tabular-nums">{formatMinor(o.totalMinor)}</div>
                {o.discountMinor > 0 ? (
                  <div className="text-xs text-amber-700">−{formatMinor(o.discountMinor)}</div>
                ) : null}
                {o.creditNotes.length > 0 ? (
                  <div className="text-xs text-red-600">
                    credited {formatMinor(o.creditNotes.reduce((s, c) => s + c.amountMinor, 0))}
                  </div>
                ) : null}
              </td>
              <td className="px-3 py-2">
                <Badge
                  tone={
                    o.status === 'SETTLED' ? 'good' : o.status === 'CANCELLED' ? 'bad' : 'warn'
                  }
                >
                  {o.status.toLowerCase()}
                </Badge>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1.5">
                  {o.invoice ? (
                    <Button size="sm" variant="ghost" onClick={() => void reprint(o.id)}>
                      Reprint
                    </Button>
                  ) : null}
                  {o.status === 'SETTLED' && can('order:refund') ? (
                    <Button size="sm" variant="secondary" onClick={() => setCrediting(o)}>
                      Credit note
                    </Button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Previous
          </Button>
          <span className="text-sm text-ink-600">
            {page} of {pages}
          </span>
          <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next →
          </Button>
        </div>
      ) : null}

      {crediting ? (
        <CreditNoteDialog
          order={crediting}
          onClose={() => setCrediting(null)}
          onDone={() => {
            setCrediting(null);
            void queryClient.invalidateQueries({ queryKey: ['orders-history'] });
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * A settled bill is never edited. This is how a mistake gets corrected: a credit note
 * against the original invoice, with a reason, which is what an auditor expects to see.
 */
function CreditNoteDialog({
  order,
  onClose,
  onDone,
}: {
  order: OrderRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const alreadyCredited = order.creditNotes.reduce((s, c) => s + c.amountMinor, 0);
  const maximum = order.totalMinor - alreadyCredited;
  const [amount, setAmount] = useState(maximum);
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () => post('/orders/credit-note', { orderId: order.id, amountMinor: amount, reason: reason.trim() }),
    onSuccess: onDone,
  });

  return (
    <FormDialog
      title={`Credit note against ${order.invoice?.invoiceNo}`}
      subtitle={`Token ${order.tokenNo} · ${formatMinor(order.totalMinor)}${alreadyCredited ? ` · ${formatMinor(alreadyCredited)} already credited` : ''}`}
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={amount <= 0 || amount > maximum || reason.trim().length < 3}
      submitLabel="Issue credit note"
    >
      <MoneyField label="Amount to credit" minor={amount} onChange={setAmount} required hint={`At most ${formatMinor(maximum)}`} />
      <TextField
        label="Reason"
        value={reason}
        onChange={setReason}
        required
        placeholder="Customer returned one thali — it was cold"
        hint="Recorded on the credit note and in the audit trail"
      />
      <Card className="!bg-ink-50 !p-3 text-sm text-ink-600">
        The original invoice is not changed. That is deliberate — a GST invoice is a legal document, and
        the credit note is the correction an auditor expects to find beside it.
      </Card>
    </FormDialog>
  );
}
