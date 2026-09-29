'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { extractGst, formatMinor, pickI18n, roundToRupee, slotForHour, type Dictionary } from '@mk/shared';
import { Badge, Button, Card, ErrorNote, Field, inputClass } from '@/components/ui';
import { StaffShell } from '@/components/staff-shell';
import { Keypad, QuantityPad } from '@/components/pos/keypad';
import { SettleDialog, type Tender } from '@/components/pos/settle-dialog';
import { ShiftBar } from '@/components/pos/shift-bar';
import { useDict, useLocale } from '@/lib/dict';
import { useSession } from '@/lib/session';
import { get } from '@/lib/api';
import { usePos, type PosLine, type PosState } from '@/lib/pos-store';
import { useOfflineQueue } from '@/lib/use-offline';
import { printBill, renderThermalBill, type BillPayload } from '@/lib/print';
import type { PublicMenuCategory } from '@/lib/server-api';

const MENU_CACHE_KEY = 'mk.pos.menu';

interface Tile {
  key: string;
  variantId: string;
  menuItemId: string;
  name: string;
  variantName: string;
  categoryId: string;
  categoryName: string;
  priceMinor: number;
  isSoldOut: boolean;
  foodType: string;
}

export default function PosPage() {
  return (
    <StaffShell requires="order:create" title="Counter" wide flush banner={<ShiftBar />} actions={<ConnectionChip />}>
      <Pos />
    </StaffShell>
  );
}

/**
 * Connection state, in the header where it is always in view.
 *
 * Silent when everything is fine — a permanently green "online" badge trains people to
 * stop seeing it, and then they do not notice the day it goes red either.
 */
function ConnectionChip() {
  const dict = useDict();
  const { online, pending, draining, drain } = useOfflineQueue();
  if (online && pending === 0) return null;
  return (
    <button
      onClick={() => void drain()}
      className={`pos-tap rounded-lg px-3 py-1.5 text-sm font-semibold ${
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
  const queryClient = useQueryClient();
  const offline = useOfflineQueue();
  const pos = usePos();

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('ALL');
  const [settling, setSettling] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [discounting, setDiscounting] = useState(false);
  const [qtyFor, setQtyFor] = useState<{ variantId: string; name: string; current: number } | null>(null);
  const [lastBill, setLastBill] = useState<BillPayload | null>(null);
  const [queuedNotice, setQueuedNotice] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [ticketOpen, setTicketOpen] = useState(false);

  useEffect(() => {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()),
    );
    pos.setSlot(slotForHour(hour));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Menu, cache-first.
   *
   * The counter must open and take an order with no network at all. The cache is written
   * on every successful fetch and read when one fails; combined with the service worker
   * holding the app shell, the POS survives a reload during a power cut.
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
          /* storage blocked — the in-memory copy still serves this shift */
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

  const categories = useMemo(
    () =>
      (menuQuery.data ?? []).map((c) => ({
        id: c.id,
        name: pickI18n(c.name, c.nameI18n, locale),
        count: c.items.reduce((n, i) => n + i.variants.length, 0),
      })),
    [menuQuery.data, locale],
  );

  const tiles = useMemo<Tile[]>(() => {
    const flat = (menuQuery.data ?? []).flatMap((c) =>
      c.items.flatMap((i) =>
        i.variants.map((v) => ({
          key: v.branchMenuItemId,
          variantId: v.variantId,
          menuItemId: i.id,
          name: pickI18n(i.name, i.nameI18n, locale),
          variantName: pickI18n(v.name, v.nameI18n, locale),
          categoryId: c.id,
          categoryName: pickI18n(c.name, c.nameI18n, locale),
          priceMinor: v.priceMinor,
          isSoldOut: v.isSoldOut,
          foodType: i.foodType,
        })),
      ),
    );

    const q = search.trim().toLowerCase();
    // Search wins over the category filter: someone typing "chai" wants chai, not
    // "no results in Thali".
    if (q) return flat.filter((t) => `${t.name} ${t.variantName} ${t.categoryName}`.toLowerCase().includes(q));
    return categoryId === 'ALL' ? flat : flat.filter((t) => t.categoryId === categoryId);
  }, [menuQuery.data, search, categoryId, locale]);

  const qtyOnTicket = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of pos.lines) map.set(l.variantId, l.qty);
    return map;
  }, [pos.lines]);

  const subtotal = pos.subtotalMinor();
  const net = Math.max(0, subtotal - pos.discountMinor);
  const tax = extractGst(net, 500).tax;
  const { rounded, adjustment } = roundToRupee(net);

  const addTile = useCallback(
    (tile: Tile) => {
      if (tile.isSoldOut) return;
      pos.add({
        variantId: tile.variantId,
        menuItemId: tile.menuItemId,
        name: tile.name,
        variantName: tile.variantName,
        priceMinor: tile.priceMinor,
      });
      // A short haptic on a tablet confirms the tap landed without the cashier looking
      // up from the customer. Silently absent on desktop.
      navigator.vibrate?.(8);
    },
    [pos],
  );

  async function submitBill(tenders: Tender[]) {
    if (!branchId) return;
    setError(null);
    const clientRef = crypto.randomUUID();

    const { result, queued } = await offline.submit<{ bill: BillPayload }>(
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
    setTicketOpen(false);
    void queryClient.invalidateQueries({ queryKey: ['cash-session', branchId] });

    if (queued) {
      setQueuedNotice(true);
      setLastBill(null);
    } else if (result?.bill) {
      setQueuedNotice(false);
      setLastBill(result.bill);
      printBill(renderThermalBill(result.bill));
    }
  }

  if (!branchId) return <p className="p-6 text-ink-400">{dict.common.loading}</p>;

  const ticket = (
    <Ticket
      dict={dict}
      pos={pos}
      tables={tablesQuery.data?.diningTables ?? []}
      subtotal={subtotal}
      tax={tax}
      adjustment={adjustment}
      total={rounded}
      canDiscount={can('order:discount')}
      onSettle={() => setSettling(true)}
      onClear={() => setConfirmClear(true)}
      onDiscount={() => setDiscounting(true)}
      onEditQty={(line) => setQtyFor({ variantId: line.variantId, name: line.name, current: line.qty })}
      lastBill={lastBill}
      queuedNotice={queuedNotice}
      onDismissLast={() => {
        setLastBill(null);
        setQueuedNotice(false);
      }}
      error={error}
    />
  );

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col lg:grid lg:grid-cols-[13rem_1fr_24rem] lg:gap-0">
      {/* ── Category rail ──────────────────────────────────────────────────
          Vertical on a tablet, because a horizontal tab strip eats the vertical
          space that item tiles need, and there are only ever a handful of
          categories. Horizontal chips on a phone, where width is the scarce axis. */}
      <nav className="shrink-0 overflow-x-auto border-b border-ink-200 bg-white lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex gap-1.5 p-2 lg:flex-col">
          {(['LUNCH', 'CHAI', 'EVENING'] as const).map((s) => (
            <button
              key={s}
              onClick={() => {
                pos.setSlot(s);
                setCategoryId('ALL');
              }}
              className={`pos-tap whitespace-nowrap rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
                pos.mealSlot === s ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 active:bg-ink-200'
              }`}
            >
              {s === 'LUNCH' ? 'Thali' : s === 'CHAI' ? 'Chai' : 'Chinese'}
            </button>
          ))}

          <div className="hidden h-px bg-ink-200 lg:my-2 lg:block" />

          <button
            onClick={() => setCategoryId('ALL')}
            className={`pos-tap whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
              categoryId === 'ALL' ? 'bg-brand-100 text-brand-800' : 'text-ink-600 active:bg-ink-100'
            }`}
          >
            {dict.menu.all}
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryId(c.id)}
              className={`pos-tap flex items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                categoryId === c.id ? 'bg-brand-100 text-brand-800' : 'text-ink-600 active:bg-ink-100'
              }`}
            >
              {c.name}
              <span className="hidden text-xs text-ink-400 lg:inline">{c.count}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* ── Item grid ─────────────────────────────────────────────────────── */}
      <section className="flex min-h-0 flex-1 flex-col bg-ink-50">
        <div className="shrink-0 p-2">
          <input
            className={inputClass}
            placeholder={dict.pos.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            // No autofocus: on a tablet it opens the keyboard over the tiles, which is
            // the opposite of what someone tapping items wants.
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-28 lg:pb-2">
          {menuQuery.isLoading ? <p className="p-4 text-ink-400">{dict.common.loading}</p> : null}
          {menuQuery.isError ? (
            <div className="p-2">
              <ErrorNote error={menuQuery.error} />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {tiles.map((tile) => (
              <ItemTile
                key={tile.key}
                tile={tile}
                onTap={() => addTile(tile)}
                onHold={() => setQtyFor({ variantId: tile.variantId, name: tile.name, current: qtyOnTicket.get(tile.variantId) ?? 0 })}
                qty={qtyOnTicket.get(tile.variantId) ?? 0}
                soldOutLabel={dict.menu.soldOut}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── Ticket: a full column on a tablet, a bottom sheet on a phone ──── */}
      <aside className="hidden min-h-0 border-l border-ink-200 bg-white lg:flex lg:flex-col">{ticket}</aside>

      {/* Phone: a permanent summary bar that opens the ticket. The total and the settle
          action are never more than one tap away, and never scroll out of reach. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white p-2 lg:hidden">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTicketOpen(true)}
            className="pos-tap flex flex-1 items-center justify-between rounded-lg bg-ink-100 px-3 py-2.5 text-left"
          >
            <span className="text-sm font-medium">
              {pos.count()} {dict.pos.items}
            </span>
            <span className="text-lg font-bold tabular-nums">{formatMinor(rounded)}</span>
          </button>
          <Button size="lg" disabled={pos.lines.length === 0} onClick={() => setSettling(true)}>
            {dict.pos.settle}
          </Button>
        </div>
      </div>

      {ticketOpen ? (
        <div className="fixed inset-0 z-40 flex flex-col bg-white lg:hidden">
          <div className="flex items-center justify-between border-b border-ink-200 p-3">
            <h2 className="font-display text-lg font-semibold">{dict.cart.title}</h2>
            <Button variant="ghost" onClick={() => setTicketOpen(false)}>
              {dict.common.close}
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{ticket}</div>
        </div>
      ) : null}

      {/* ── Dialogs ───────────────────────────────────────────────────────── */}
      {settling ? (
        <SettleDialog totalMinor={rounded} onCancel={() => setSettling(false)} onConfirm={submitBill} />
      ) : null}

      {qtyFor ? (
        <QuantityDialog
          title={qtyFor.name}
          initial={qtyFor.current}
          onCancel={() => setQtyFor(null)}
          onConfirm={(qty) => {
            const existing = pos.lines.find((l) => l.variantId === qtyFor.variantId);
            if (existing) {
              pos.bump(qtyFor.variantId, qty - existing.qty);
            } else if (qty > 0) {
              const tile = tiles.find((t) => t.variantId === qtyFor.variantId);
              if (tile) {
                pos.add({
                  variantId: tile.variantId,
                  menuItemId: tile.menuItemId,
                  name: tile.name,
                  variantName: tile.variantName,
                  priceMinor: tile.priceMinor,
                });
                pos.bump(tile.variantId, qty - 1);
              }
            }
            setQtyFor(null);
          }}
        />
      ) : null}

      {confirmClear ? (
        <ConfirmDialog
          title={dict.pos.clearTicket}
          body={dict.pos.clearConfirm}
          confirmLabel={dict.pos.clearTicket}
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            pos.reset();
            setConfirmClear(false);
            setTicketOpen(false);
          }}
        />
      ) : null}

      {discounting ? (
        <DiscountDialog
          maxMinor={subtotal}
          current={pos.discountMinor}
          currentReason={pos.discountReason}
          onCancel={() => setDiscounting(false)}
          onConfirm={(minor, reason) => {
            pos.setDiscount(minor, reason);
            setDiscounting(false);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * A menu tile.
 *
 * Tap adds one. Press and hold opens the quantity pad — six thalis should not be six
 * taps. The scale-down on press exists because touch has no hover: without it, a tap
 * that registered and one that missed look identical.
 */
function ItemTile({
  tile,
  onTap,
  onHold,
  qty,
  soldOutLabel,
}: {
  tile: Tile;
  onTap: () => void;
  onHold: () => void;
  qty: number;
  soldOutLabel: string;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  const start = () => {
    held.current = false;
    timer.current = setTimeout(() => {
      held.current = true;
      navigator.vibrate?.(20);
      onHold();
    }, 450);
  };
  const end = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  return (
    <button
      disabled={tile.isSoldOut}
      onPointerDown={start}
      onPointerUp={end}
      onPointerLeave={end}
      onClick={() => {
        // A long press already did its work; do not also add one.
        if (!held.current) onTap();
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={`pos-tap relative flex h-24 flex-col justify-between rounded-xl border-2 p-2.5 text-left transition-transform ${
        tile.isSoldOut
          ? 'cursor-not-allowed border-ink-200 bg-ink-100 text-ink-400'
          : qty > 0
            ? 'border-brand-500 bg-brand-50 active:scale-[0.97]'
            : 'border-ink-200 bg-white active:scale-[0.97] active:bg-brand-50'
      }`}
    >
      {qty > 0 ? (
        <span className="absolute -right-1.5 -top-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-brand-600 px-1.5 text-xs font-bold text-white">
          {qty}
        </span>
      ) : null}

      <span className="text-sm font-semibold leading-tight">
        {tile.name}
        {tile.variantName !== 'Regular' ? (
          <span className="block text-xs font-normal text-ink-400">{tile.variantName}</span>
        ) : null}
      </span>

      <span className="flex items-center justify-between">
        <span className="text-base font-bold tabular-nums">{formatMinor(tile.priceMinor)}</span>
        {tile.isSoldOut ? <Badge tone="bad">{soldOutLabel}</Badge> : null}
      </span>
    </button>
  );
}

/**
 * The order ticket.
 *
 * A flex column whose middle scrolls and whose footer does not: the total and the Settle
 * button are pinned to the bottom of the panel and cannot be scrolled away, no matter how
 * many lines are on the bill. That is the whole point of the rework — the most-pressed
 * control in the business used to sit at the end of a scrolling list.
 */
function Ticket({
  dict,
  pos,
  tables,
  subtotal,
  tax,
  adjustment,
  total,
  canDiscount,
  onSettle,
  onClear,
  onDiscount,
  onEditQty,
  lastBill,
  queuedNotice,
  onDismissLast,
  error,
}: {
  dict: Dictionary;
  pos: PosState;
  tables: { id: string; label: string }[];
  subtotal: number;
  tax: number;
  adjustment: number;
  total: number;
  canDiscount: boolean;
  onSettle: () => void;
  onClear: () => void;
  onDiscount: () => void;
  onEditQty: (line: PosLine) => void;
  lastBill: BillPayload | null;
  queuedNotice: boolean;
  onDismissLast: () => void;
  error: unknown;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Channel + table: the two things that change per order, at the top. */}
      <div className="shrink-0 border-b border-ink-100 p-2">
        <div className="flex gap-2">
          {(['TAKEAWAY', 'DINE_IN'] as const).map((c) => (
            <button
              key={c}
              onClick={() => pos.setChannel(c)}
              className={`pos-tap flex-1 rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
                pos.channel === c ? 'bg-ink-800 text-white' : 'bg-ink-100 text-ink-600'
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
              {tables.map((t) => (
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
      </div>

      {/* Lines — the only part that scrolls. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {lastBill || queuedNotice ? (
          <LastBillStrip bill={lastBill} queued={queuedNotice} onDismiss={onDismissLast} dict={dict} />
        ) : null}

        {pos.lines.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-400">{dict.cart.empty}</p>
        ) : (
          <ul className="space-y-1.5">
            {pos.lines.map((l) => (
              <li key={l.variantId} className="rounded-lg border border-ink-100 p-2">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{l.name}</div>
                    <div className="text-xs text-ink-400">
                      {l.variantName} · {formatMinor(l.priceMinor)}
                    </div>
                  </div>
                  <span className="whitespace-nowrap text-sm font-bold tabular-nums">
                    {formatMinor(l.priceMinor * l.qty)}
                  </span>
                </div>

                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    className="pos-tap grid h-10 w-10 place-items-center rounded-lg border border-ink-200 text-xl active:bg-ink-100"
                    onClick={() => pos.bump(l.variantId, -1)}
                    aria-label={`Remove one ${l.name}`}
                  >
                    −
                  </button>
                  {/* Tapping the number opens the pad — faster than eight taps of +. */}
                  <button
                    className="pos-tap h-10 min-w-12 rounded-lg bg-ink-100 px-3 text-lg font-bold tabular-nums"
                    onClick={() => onEditQty(l)}
                    aria-label={`${dict.pos.quantity}: ${l.qty}`}
                  >
                    {l.qty}
                  </button>
                  <button
                    className="pos-tap grid h-10 w-10 place-items-center rounded-lg border border-ink-200 text-xl active:bg-ink-100"
                    onClick={() => pos.bump(l.variantId, 1)}
                    aria-label={`Add one ${l.name}`}
                  >
                    +
                  </button>
                  <input
                    className="h-10 min-w-0 flex-1 rounded-lg border border-ink-100 px-2 text-xs"
                    placeholder="less spicy…"
                    value={l.notes ?? ''}
                    onChange={(e) => pos.setNotes(l.variantId, e.target.value)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pinned footer — totals and the action. Never scrolls. */}
      <div className="shrink-0 border-t border-ink-200 bg-white p-2">
        <dl className="space-y-0.5 text-sm">
          <Row label={dict.cart.subtotal} value={formatMinor(subtotal)} />
          {pos.discountMinor > 0 ? (
            <Row
              label={`${dict.pos.discount}${pos.discountReason ? ` · ${pos.discountReason}` : ''}`}
              value={`−${formatMinor(pos.discountMinor)}`}
              tone="discount"
            />
          ) : null}
          <Row label={`${dict.cart.tax} (incl.)`} value={formatMinor(tax)} tone="muted" />
          {adjustment !== 0 ? <Row label="Round off" value={formatMinor(adjustment)} tone="muted" /> : null}
        </dl>

        <div className="mt-1.5 flex items-baseline justify-between border-t border-ink-100 pt-1.5">
          <span className="font-semibold">{dict.cart.total}</span>
          <span className="text-3xl font-bold tabular-nums">{formatMinor(total)}</span>
        </div>

        <ErrorNote error={error} />

        <Button
          size="lg"
          variant="leaf"
          className="mt-2 w-full !py-4 text-xl"
          disabled={pos.lines.length === 0}
          onClick={onSettle}
        >
          {dict.pos.settle} · {formatMinor(total)}
        </Button>

        {/* Secondary actions, visually demoted. Clear is last and confirms, because it
            destroys the ticket and used to sit next to a harmless Reprint at identical
            weight — an invitation to the wrong tap. */}
        <div className="mt-1.5 flex items-center gap-1">
          {canDiscount ? (
            <Button variant="ghost" size="sm" className="flex-1" onClick={onDiscount}>
              {dict.pos.discount}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            disabled={!lastBill}
            onClick={() => lastBill && printBill(renderThermalBill(lastBill, { copy: 'DUPLICATE' }))}
          >
            {dict.pos.reprint}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 !text-red-600"
            disabled={pos.lines.length === 0}
            onClick={onClear}
          >
            {dict.pos.clearTicket}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The token of the bill just settled, kept on screen until dismissed.
 *
 * This replaces a toast that vanished after four seconds. The token number is the thing
 * shouted across the counter when the food is ready — it has to still be there when the
 * cashier looks back up.
 */
function LastBillStrip({
  bill,
  queued,
  onDismiss,
  dict,
}: {
  bill: BillPayload | null;
  queued: boolean;
  onDismiss: () => void;
  dict: Dictionary;
}) {
  if (queued) {
    return (
      <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
        <span>{dict.pos.offline}</span>
        <button onClick={onDismiss} aria-label={dict.common.close} className="pos-tap px-2 font-bold">
          ✕
        </button>
      </div>
    );
  }
  if (!bill) return null;

  return (
    <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-leaf-100 px-3 py-2">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-leaf-600">{dict.pos.lastBill}</div>
        <div className="text-sm text-ink-800">
          <span className="text-2xl font-bold tabular-nums text-leaf-600">{bill.tokenNo}</span>
          <span className="ml-2 tabular-nums">{formatMinor(bill.totalMinor)}</span>
        </div>
      </div>
      <button onClick={onDismiss} aria-label={dict.common.close} className="pos-tap px-2 font-bold text-leaf-600">
        ✕
      </button>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'muted' | 'discount' }) {
  return (
    <div
      className={`flex justify-between ${
        tone === 'muted' ? 'text-ink-400' : tone === 'discount' ? 'text-amber-700' : 'text-ink-600'
      }`}
    >
      <dt className="truncate">{label}</dt>
      <dd className="whitespace-nowrap tabular-nums">{value}</dd>
    </div>
  );
}

function QuantityDialog({
  title,
  initial,
  onCancel,
  onConfirm,
}: {
  title: string;
  initial: number;
  onCancel: () => void;
  onConfirm: (qty: number) => void;
}) {
  const dict = useDict();
  const [qty, setQty] = useState(initial);

  return (
    <Modal label={dict.pos.quantity} onClose={onCancel}>
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <div className="my-3 rounded-xl border border-ink-200 bg-ink-50 py-4 text-center text-4xl font-bold tabular-nums">
        {qty}
      </div>
      <QuantityPad value={qty} onChange={setQty} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" onClick={onCancel}>
          {dict.common.cancel}
        </Button>
        <Button size="lg" onClick={() => onConfirm(qty)}>
          {dict.common.confirm}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Discounts, as a real control rather than the collapsed stub this used to be.
 *
 * A reason is required: a discount is money leaving the business, it is audited, and
 * "someone gave ₹40 off" with no explanation is exactly the entry a partner will ask
 * about three weeks later.
 */
function DiscountDialog({
  maxMinor,
  current,
  currentReason,
  onCancel,
  onConfirm,
}: {
  maxMinor: number;
  current: number;
  currentReason: string;
  onCancel: () => void;
  onConfirm: (minor: number, reason: string) => void;
}) {
  const dict = useDict();
  const [amount, setAmount] = useState(current);
  const [reason, setReason] = useState(currentReason);
  const tooMuch = amount > maxMinor;

  return (
    <Modal label={dict.pos.discount} onClose={onCancel}>
      <h2 className="font-display text-lg font-semibold">{dict.pos.discount}</h2>
      <p className="mt-1 text-sm text-ink-400">Bill is {formatMinor(maxMinor)}</p>

      <div className="mt-3">
        <Keypad value={amount} onChange={setAmount} />
      </div>

      <div className="mt-3 flex gap-2">
        {[5, 10].map((pct) => (
          <button
            key={pct}
            onClick={() => setAmount(Math.round((maxMinor * pct) / 100))}
            className="pos-tap flex-1 rounded-lg border border-ink-200 py-2 text-sm font-semibold"
          >
            {pct}%
          </button>
        ))}
        <button
          onClick={() => setAmount(0)}
          className="pos-tap flex-1 rounded-lg border border-ink-200 py-2 text-sm text-ink-600"
        >
          {dict.common.cancel}
        </button>
      </div>

      <div className="mt-3">
        <Field label={dict.pos.discountReason}>
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>

      {tooMuch ? <p className="mt-2 text-sm text-red-600">A discount cannot exceed the bill.</p> : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" onClick={onCancel}>
          {dict.common.cancel}
        </Button>
        <Button
          size="lg"
          disabled={tooMuch || (amount > 0 && reason.trim().length < 2)}
          onClick={() => onConfirm(amount, reason.trim())}
        >
          {dict.common.confirm}
        </Button>
      </div>
    </Modal>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dict = useDict();
  return (
    <Modal label={title} onClose={onCancel}>
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-ink-600">{body}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" onClick={onCancel}>
          {dict.common.cancel}
        </Button>
        <Button variant="danger" size="lg" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

function Modal({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/60 sm:items-center sm:p-4"
      role="dialog"
      aria-modal
      aria-label={label}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <Card className="max-h-[95vh] w-full max-w-sm overflow-y-auto rounded-b-none sm:rounded-xl">{children}</Card>
    </div>
  );
}
