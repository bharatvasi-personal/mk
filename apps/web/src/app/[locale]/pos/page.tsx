'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { extractGst, formatMinor, pickI18n, roundToRupee, slotForHour, type TenderType } from '@mk/shared';
import { Badge, Button, Card, ErrorNote, Field, inputClass } from '@/components/ui';
import { StaffShell } from '@/components/staff-shell';
import { useDict, useLocale } from '@/lib/dict';
import { useSession } from '@/lib/session';
import { get, post } from '@/lib/api';
import { usePos } from '@/lib/pos-store';
import { useOfflineQueue } from '@/lib/use-offline';
import { printBill, renderThermalBill, type BillPayload } from '@/lib/print';
import type { PublicMenuCategory } from '@/lib/server-api';

const MENU_CACHE_KEY = 'mk.pos.menu';

export default function PosPage() {
  return (
    <StaffShell requires="order:create" title="Counter" wide actions={<QueueBadge />}>
      <Pos />
    </StaffShell>
  );
}

function QueueBadge() {
  const dict = useDict();
  const { online, pending, draining, drain } = useOfflineQueue();
  if (online && pending === 0) return null;
  return (
    <button
      onClick={() => void drain()}
      className={`pos-tap rounded-lg px-3 py-1.5 text-sm font-medium ${
        online ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'
      }`}
    >
      {online ? `${pending} ${dict.pos.queued}` : dict.pos.offline}
      {draining ? '…' : ''}
    </button>
  );
}

function Pos() {
  const dict = useDict();
  const locale = useLocale();
  const { branchId, can } = useSession();
  const pos = usePos();
  const queryClient = useQueryClient();
  const offline = useOfflineQueue();

  const [search, setSearch] = useState('');
  const [settling, setSettling] = useState(false);
  const [lastBill, setLastBill] = useState<BillPayload | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Preselect the slot from the clock so nobody has to think at 1 pm.
  useEffect(() => {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()),
    );
    pos.setSlot(slotForHour(hour));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The menu is cached in localStorage and served from cache first.
   *
   * The POS must open and take an order with no network at all — this is the shop's
   * livelihood, not a nicety. The cache is refreshed in the background whenever the
   * request succeeds.
   */
  const menuQuery = useQuery({
    queryKey: ['pos-menu', branchId, pos.mealSlot],
    enabled: !!branchId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const key = `${MENU_CACHE_KEY}.${branchId}.${pos.mealSlot}`;
      try {
        const fresh = await get<PublicMenuCategory[]>(`/menu/branch/${branchId}?mealSlot=${pos.mealSlot}`);
        try {
          window.localStorage.setItem(key, JSON.stringify({ at: Date.now(), data: fresh }));
        } catch {
          /* storage full or blocked — the in-memory copy still serves this shift */
        }
        return fresh;
      } catch (err) {
        const cached = window.localStorage.getItem(key);
        if (cached) return (JSON.parse(cached) as { data: PublicMenuCategory[] }).data;
        throw err;
      }
    },
  });

  const tablesQuery = useQuery({
    queryKey: ['branch', branchId],
    enabled: !!branchId,
    queryFn: () => get<{ diningTables: { id: string; label: string; seats: number }[] }>(`/branches/${branchId}`),
  });

  const cashQuery = useQuery({
    queryKey: ['cash-session', branchId],
    enabled: !!branchId && can('cash_session:manage'),
    refetchInterval: 60_000,
    queryFn: () =>
      get<{ id: string; openingFloatMinor: number; expectedCashMinor: number; orderCount: number } | null>(
        `/cash-sessions/current?branchId=${branchId}`,
      ),
  });

  const items = useMemo(() => {
    const flat = (menuQuery.data ?? []).flatMap((c) =>
      c.items.flatMap((i) =>
        i.variants.map((v) => ({
          key: v.branchMenuItemId,
          variantId: v.variantId,
          menuItemId: i.id,
          name: pickI18n(i.name, i.nameI18n, locale),
          variantName: pickI18n(v.name, v.nameI18n, locale),
          category: pickI18n(c.name, c.nameI18n, locale),
          priceMinor: v.priceMinor,
          isSoldOut: v.isSoldOut,
          foodType: i.foodType,
        })),
      ),
    );
    if (!search.trim()) return flat;
    const q = search.trim().toLowerCase();
    return flat.filter((i) => `${i.name} ${i.variantName} ${i.category}`.toLowerCase().includes(q));
  }, [menuQuery.data, search, locale]);

  const subtotal = pos.subtotalMinor();
  const net = Math.max(0, subtotal - pos.discountMinor);
  const tax = extractGst(net, 500).tax;
  const { rounded, adjustment } = roundToRupee(net);

  async function submitBill(tenders: { tender: TenderType; amountMinor: number; tenderedMinor?: number; reference?: string }[]) {
    if (!branchId) return;
    setError(null);
    const clientRef = crypto.randomUUID();
    try {
      const { result, queued } = await offline.submit<{ bill: BillPayload; changeMinor: number }>(
        '/orders/quick-bill',
        {
          branchId,
          clientRef,
          channel: pos.channel,
          mealSlot: pos.mealSlot,
          tableId: pos.tableId ?? undefined,
          guestCount: pos.channel === 'DINE_IN' ? pos.guestCount : undefined,
          items: pos.lines.map((l) => ({ variantId: l.variantId, qty: l.qty, notes: l.notes })),
          discountMinor: pos.discountMinor,
          discountReason: pos.discountReason || undefined,
          tenders,
          roundOff: true,
          sendToKitchen: true,
        },
        clientRef,
        `Bill ${formatMinor(rounded)}`,
      );

      pos.reset();
      setSettling(false);
      void queryClient.invalidateQueries({ queryKey: ['cash-session', branchId] });

      if (queued) {
        setToast(dict.pos.offline);
      } else if (result?.bill) {
        setLastBill(result.bill);
        printBill(renderThermalBill(result.bill));
        setToast(`${dict.common.saved} · ${dict.pos.token} ${result.bill.tokenNo}`);
      }
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      setError(err);
    }
  }

  if (!branchId) return <p className="text-ink-400">{dict.common.loading}</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
      {/* ── Menu grid ─────────────────────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(['LUNCH', 'CHAI', 'EVENING'] as const).map((s) => (
            <button
              key={s}
              onClick={() => pos.setSlot(s)}
              className={`pos-tap rounded-lg px-4 py-2 text-sm font-semibold ${
                pos.mealSlot === s ? 'bg-brand-600 text-white' : 'border border-ink-200 bg-white text-ink-600'
              }`}
            >
              {s === 'LUNCH' ? 'Thali' : s === 'CHAI' ? 'Chai' : 'Chinese'}
            </button>
          ))}
          <input
            className={`${inputClass} ml-auto max-w-56`}
            placeholder={dict.pos.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {menuQuery.isLoading ? <p className="text-ink-400">{dict.common.loading}</p> : null}
        {menuQuery.isError ? <ErrorNote error={menuQuery.error} /> : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <button
              key={item.key}
              disabled={item.isSoldOut}
              onClick={() =>
                pos.add({
                  variantId: item.variantId,
                  menuItemId: item.menuItemId,
                  name: item.name,
                  variantName: item.variantName,
                  priceMinor: item.priceMinor,
                })
              }
              className={`pos-tap flex h-24 flex-col justify-between rounded-xl border p-3 text-left transition-colors ${
                item.isSoldOut
                  ? 'cursor-not-allowed border-ink-200 bg-ink-100 text-ink-400'
                  : 'border-ink-200 bg-white hover:border-brand-400 hover:bg-brand-50'
              }`}
            >
              <span className="text-sm font-medium leading-tight">
                {item.name}
                {item.variantName !== 'Regular' ? (
                  <span className="text-ink-400"> · {item.variantName}</span>
                ) : null}
              </span>
              <span className="flex items-center justify-between">
                <span className="font-semibold tabular-nums">{formatMinor(item.priceMinor)}</span>
                {item.isSoldOut ? <Badge tone="bad">{dict.menu.soldOut}</Badge> : null}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Ticket ────────────────────────────────────────────────────────── */}
      <aside className="lg:sticky lg:top-28 lg:self-start">
        <Card className="flex max-h-[calc(100vh-9rem)] flex-col">
          <div className="flex gap-2">
            {(['TAKEAWAY', 'DINE_IN'] as const).map((c) => (
              <button
                key={c}
                onClick={() => pos.setChannel(c)}
                className={`pos-tap flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
                  pos.channel === c ? 'bg-ink-800 text-white' : 'border border-ink-200 text-ink-600'
                }`}
              >
                {c === 'TAKEAWAY' ? dict.pos.takeaway : dict.pos.dineIn}
              </button>
            ))}
          </div>

          {pos.channel === 'DINE_IN' ? (
            <div className="mt-2 flex gap-2">
              <select
                className={inputClass}
                value={pos.tableId ?? ''}
                onChange={(e) => pos.setTable(e.target.value || null)}
              >
                <option value="">{dict.pos.table}…</option>
                {(tablesQuery.data?.diningTables ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                aria-label={dict.pos.guests}
                type="number"
                min={1}
                max={20}
                className={`${inputClass} w-20`}
                value={pos.guestCount}
                onChange={(e) => pos.setGuests(Number(e.target.value) || 1)}
              />
            </div>
          ) : null}

          <div className="mt-3 flex-1 overflow-y-auto">
            {pos.lines.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">{dict.cart.empty}</p>
            ) : (
              <ul className="space-y-2">
                {pos.lines.map((l) => (
                  <li key={l.variantId} className="rounded-lg border border-ink-100 p-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 text-sm">
                        <div className="font-medium">{l.name}</div>
                        <div className="text-xs text-ink-400">
                          {l.variantName} · {formatMinor(l.priceMinor)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          className="pos-tap grid h-9 w-9 place-items-center rounded border border-ink-200 text-lg"
                          onClick={() => pos.bump(l.variantId, -1)}
                          aria-label="decrease"
                        >
                          −
                        </button>
                        <span className="w-6 text-center font-semibold tabular-nums">{l.qty}</span>
                        <button
                          className="pos-tap grid h-9 w-9 place-items-center rounded border border-ink-200 text-lg"
                          onClick={() => pos.bump(l.variantId, 1)}
                          aria-label="increase"
                        >
                          +
                        </button>
                      </div>
                      <span className="w-16 text-right text-sm font-semibold tabular-nums">
                        {formatMinor(l.priceMinor * l.qty)}
                      </span>
                    </div>
                    <input
                      className="mt-1 w-full rounded border border-ink-100 px-2 py-1 text-xs"
                      placeholder="less spicy, no onion…"
                      value={l.notes ?? ''}
                      onChange={(e) => pos.setNotes(l.variantId, e.target.value)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-3 border-t border-ink-100 pt-3 text-sm">
            <Row label={dict.cart.subtotal} value={formatMinor(subtotal)} />
            {pos.discountMinor > 0 ? (
              <Row label="Discount" value={`-${formatMinor(pos.discountMinor)}`} />
            ) : null}
            <Row label={`${dict.cart.tax} (incl.)`} value={formatMinor(tax)} muted />
            {adjustment !== 0 ? <Row label="Round off" value={formatMinor(adjustment)} muted /> : null}
            <div className="mt-1 flex items-baseline justify-between border-t border-ink-100 pt-2">
              <span className="font-semibold">{dict.cart.total}</span>
              <span className="text-2xl font-bold tabular-nums">{formatMinor(rounded)}</span>
            </div>
          </div>

          <ErrorNote error={error} />

          <div className="mt-3 grid gap-2">
            <Button size="lg" disabled={pos.lines.length === 0} onClick={() => setSettling(true)}>
              {dict.pos.settle}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={pos.lines.length === 0} onClick={() => pos.reset()}>
                {dict.cart.clear}
              </Button>
              <Button
                variant="secondary"
                disabled={!lastBill}
                onClick={() => lastBill && printBill(renderThermalBill(lastBill, { copy: 'DUPLICATE' }))}
              >
                {dict.pos.reprint}
              </Button>
            </div>
          </div>

          {can('cash_session:manage') ? (
            <CashDrawer session={cashQuery.data ?? null} onChanged={() => void cashQuery.refetch()} />
          ) : null}
        </Card>
      </aside>

      {settling ? (
        <SettleDialog
          totalMinor={rounded}
          onCancel={() => setSettling(false)}
          onConfirm={submitBill}
          canDiscount={can('order:discount')}
          onDiscount={(minor, reason) => pos.setDiscount(minor, reason)}
        />
      ) : null}

      {toast ? (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? 'text-ink-400' : 'text-ink-600'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/**
 * The settle dialog.
 *
 * Cash is the default and the keypad shows the common notes, because most bills are
 * settled with a ₹100 or ₹200 note and the change has to be right the first time. A UPI
 * tender cannot be confirmed without the UTR — that field is the only thing that makes
 * the bank statement reconcilable at month end.
 */
function SettleDialog({
  totalMinor,
  onCancel,
  onConfirm,
  canDiscount,
  onDiscount,
}: {
  totalMinor: number;
  onCancel: () => void;
  onConfirm: (tenders: { tender: TenderType; amountMinor: number; tenderedMinor?: number; reference?: string }[]) => Promise<void>;
  canDiscount: boolean;
  onDiscount: (minor: number, reason: string) => void;
}) {
  const dict = useDict();
  const [mode, setMode] = useState<'CASH' | 'UPI_MANUAL' | 'CARD' | 'SPLIT'>('CASH');
  const [tendered, setTendered] = useState<number>(totalMinor);
  const [utr, setUtr] = useState('');
  const [cashPart, setCashPart] = useState(0);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const change = Math.max(0, tendered - totalMinor);

  async function confirm() {
    setLocalError(null);
    let tenders: { tender: TenderType; amountMinor: number; tenderedMinor?: number; reference?: string }[];

    if (mode === 'CASH') {
      if (tendered < totalMinor) return setLocalError('Cash received is less than the bill');
      tenders = [{ tender: 'CASH', amountMinor: totalMinor, tenderedMinor: tendered }];
    } else if (mode === 'UPI_MANUAL') {
      if (!utr.trim()) return setLocalError(`${dict.pos.utr} is required`);
      tenders = [{ tender: 'UPI_MANUAL', amountMinor: totalMinor, reference: utr.trim() }];
    } else if (mode === 'CARD') {
      tenders = [{ tender: 'CARD', amountMinor: totalMinor, reference: utr.trim() || undefined }];
    } else {
      const upiPart = totalMinor - cashPart;
      if (cashPart <= 0 || upiPart <= 0) return setLocalError('Split both ways, or use a single tender');
      if (!utr.trim()) return setLocalError(`${dict.pos.utr} is required for the UPI part`);
      tenders = [
        { tender: 'CASH', amountMinor: cashPart, tenderedMinor: cashPart },
        { tender: 'UPI_MANUAL', amountMinor: upiPart, reference: utr.trim() },
      ];
    }

    setBusy(true);
    try {
      await onConfirm(tenders);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink-900/50 p-4" role="dialog" aria-modal>
      <Card className="w-full max-w-md">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg font-semibold">{dict.pos.settle}</h2>
          <span className="text-3xl font-bold tabular-nums text-brand-700">{formatMinor(totalMinor)}</span>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2">
          {(['CASH', 'UPI_MANUAL', 'CARD', 'SPLIT'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`pos-tap rounded-lg px-2 py-2 text-sm font-semibold ${
                mode === m ? 'bg-brand-600 text-white' : 'border border-ink-200 text-ink-600'
              }`}
            >
              {m === 'CASH' ? dict.pos.cash : m === 'UPI_MANUAL' ? dict.pos.upi : m === 'CARD' ? dict.pos.card : 'Split'}
            </button>
          ))}
        </div>

        {mode === 'CASH' ? (
          <div className="mt-4">
            <Field label={dict.pos.tendered}>
              <input
                className={`${inputClass} text-right text-xl`}
                type="number"
                value={tendered / 100}
                onChange={(e) => setTendered(Math.round(Number(e.target.value) * 100))}
                autoFocus
              />
            </Field>
            <div className="mt-2 flex flex-wrap gap-2">
              {[totalMinor, 10000, 20000, 50000, 100000].map((amount, i) => (
                <button
                  key={`${amount}-${i}`}
                  onClick={() => setTendered(amount)}
                  className="pos-tap rounded-lg border border-ink-200 px-3 py-1.5 text-sm tabular-nums"
                >
                  {i === 0 ? 'Exact' : formatMinor(amount, { withSymbol: false })}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-baseline justify-between rounded-lg bg-leaf-100 px-3 py-2">
              <span className="font-medium text-leaf-600">{dict.pos.change}</span>
              <span className="text-2xl font-bold tabular-nums text-leaf-600">{formatMinor(change)}</span>
            </div>
          </div>
        ) : null}

        {mode === 'SPLIT' ? (
          <Field label={`${dict.pos.cash} part`}>
            <input
              className={`${inputClass} text-right`}
              type="number"
              value={cashPart / 100}
              onChange={(e) => setCashPart(Math.round(Number(e.target.value) * 100))}
            />
          </Field>
        ) : null}

        {mode === 'UPI_MANUAL' || mode === 'CARD' || mode === 'SPLIT' ? (
          <div className="mt-4">
            <Field
              label={mode === 'CARD' ? 'Auth code' : dict.pos.utr}
              hint={mode === 'CARD' ? undefined : 'From the customer’s UPI app — needed to match the bank statement'}
            >
              <input className={inputClass} value={utr} onChange={(e) => setUtr(e.target.value)} autoFocus />
            </Field>
          </div>
        ) : null}

        {canDiscount ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-ink-600">Apply a discount</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                className={inputClass}
                type="number"
                placeholder="₹"
                onChange={(e) => onDiscount(Math.round(Number(e.target.value) * 100), 'Counter discount')}
              />
              <input className={inputClass} placeholder="Reason" onChange={(e) => onDiscount(0, e.target.value)} />
            </div>
            <p className="mt-1 text-xs text-ink-400">Close and reopen this dialog to recalculate.</p>
          </details>
        ) : null}

        {localError ? <p className="mt-3 text-sm text-red-600">{localError}</p> : null}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {dict.common.cancel}
          </Button>
          <Button onClick={confirm} disabled={busy} size="lg">
            {busy ? dict.common.saving : dict.pos.printBill}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/** Open the drawer with a float, close it against a counted amount. */
function CashDrawer({
  session,
  onChanged,
}: {
  session: { id: string; openingFloatMinor: number; expectedCashMinor: number; orderCount: number } | null;
  onChanged: () => void;
}) {
  const dict = useDict();
  const { branchId } = useSession();
  const [float, setFloat] = useState(200000);
  const [counted, setCounted] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [zReport, setZReport] = useState<{ varianceMinor: number; expectedCashMinor: number } | null>(null);

  if (!session) {
    return (
      <div className="mt-4 border-t border-ink-100 pt-3">
        <Field label={dict.pos.openingFloat}>
          <input
            className={inputClass}
            type="number"
            value={float / 100}
            onChange={(e) => setFloat(Math.round(Number(e.target.value) * 100))}
          />
        </Field>
        <ErrorNote error={error} />
        <Button
          variant="leaf"
          className="mt-2 w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await post('/cash-sessions/open', { branchId, openingFloatMinor: float });
              onChanged();
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {dict.pos.openDrawer}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-ink-100 pt-3 text-sm">
      <div className="flex justify-between text-ink-600">
        <span>{dict.pos.expectedCash}</span>
        <span className="font-semibold tabular-nums">{formatMinor(session.expectedCashMinor)}</span>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-ink-600">{dict.pos.closeDrawer}</summary>
        <Field label={dict.pos.countedCash}>
          <input
            className={inputClass}
            type="number"
            value={counted / 100}
            onChange={(e) => setCounted(Math.round(Number(e.target.value) * 100))}
          />
        </Field>
        <ErrorNote error={error} />
        {zReport ? (
          <p
            className={`mt-2 rounded px-2 py-1 text-xs ${
              zReport.varianceMinor === 0
                ? 'bg-leaf-100 text-leaf-600'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            {dict.pos.variance}: {formatMinor(zReport.varianceMinor)}
          </p>
        ) : null}
        <Button
          variant="secondary"
          className="mt-2 w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await post<{ varianceMinor: number; expectedCashMinor: number }>('/cash-sessions/close', {
                cashSessionId: session.id,
                countedCashMinor: counted,
              });
              setZReport(res);
              onChanged();
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {dict.pos.closeDrawer}
        </Button>
      </details>
    </div>
  );
}
