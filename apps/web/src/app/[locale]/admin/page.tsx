'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { formatBp, formatMinor, formatMinorCompact } from '@mk/shared';
import { Badge, Card, Empty, ErrorNote, Stat, Table } from '@/components/ui';
import { StaffShell } from '@/components/staff-shell';
import { get } from '@/lib/api';
import { useDict, useLocale } from '@/lib/dict';
import { useSession } from '@/lib/session';

interface TodayReport {
  date: string;
  orderCount: number;
  guestCount: number;
  grossSalesMinor: number;
  netSalesMinor: number;
  cogsMinor: number;
  wastageMinor: number;
  labourCostMinor: number;
  avgTicketMinor: number;
  foodCostBp: number;
  labourCostBp: number;
  cashSalesMinor: number;
  upiSalesMinor: number;
  cardSalesMinor: number;
  onlineSalesMinor: number;
  slotBreakdown: { mealSlot: string; orders: number; netMinor: number }[];
  topItems: { menuItemId: string; name: string; qty: number; revenueMinor: number }[];
}

export default function DashboardPage() {
  return (
    <StaffShell requires="report:sales" title="Dashboard">
      <Dashboard />
    </StaffShell>
  );
}

/**
 * The owner's screen.
 *
 * Deliberately short. It answers four questions a partner actually asks — did we sell,
 * what did it cost, what needs buying, and what needs paying — and links to the detail
 * rather than trying to be the detail.
 */
function Dashboard() {
  const dict = useDict();
  const locale = useLocale();
  const { branchId, can } = useSession();

  const today = useQuery({
    queryKey: ['today', branchId],
    enabled: !!branchId,
    refetchInterval: 120_000,
    queryFn: () => get<TodayReport>(`/reports/today/${branchId}`),
  });

  const lowStock = useQuery({
    queryKey: ['low-stock', branchId],
    enabled: !!branchId && can('inventory:read'),
    queryFn: () =>
      get<{ inventoryItemId: string; name: string; onHandQty: string; reorderPointQty: string; isOut: boolean }[]>(
        `/inventory/on-hand/${branchId}?lowOnly=true`,
      ),
  });

  const payables = useQuery({
    queryKey: ['payables-week'],
    enabled: can('payable:read'),
    queryFn: () =>
      get<{ id: string; vendor: { name: string }; billNo: string; dueOn: string; outstandingMinor: number; isOverdue: boolean }[]>(
        '/vendors/payables/list?dueWithinDays=7',
      ),
  });

  const compliance = useQuery({
    queryKey: ['compliance'],
    enabled: can('legal:read'),
    queryFn: () =>
      get<{ expired: { id: string; title: string }[]; expiringSoon: { id: string; title: string; daysToExpiry: number }[]; missing: string[] }>(
        '/legal/compliance',
      ),
  });

  const t = today.data;
  const foodCostTone = !t ? undefined : t.foodCostBp > 3500 ? 'bad' : t.foodCostBp > 3200 ? 'warn' : 'good';
  const labourTone = !t ? undefined : t.labourCostBp > 2500 ? 'bad' : t.labourCostBp > 2000 ? 'warn' : 'good';

  return (
    <div className="space-y-6">
      <ErrorNote error={today.error} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={dict.reports.revenue}
          value={t ? formatMinor(t.grossSalesMinor) : '—'}
          sub={t ? `${t.orderCount} ${dict.reports.orders.toLowerCase()}` : undefined}
        />
        <Stat label={dict.reports.avgTicket} value={t ? formatMinor(t.avgTicketMinor) : '—'} />
        <Stat
          label={dict.reports.foodCost}
          value={t ? formatBp(t.foodCostBp) : '—'}
          sub={t ? `${dict.reports.cogs} ${formatMinor(t.cogsMinor)}` : undefined}
          tone={foodCostTone}
        />
        <Stat
          label={dict.reports.labourCost}
          value={t ? formatBp(t.labourCostBp) : '—'}
          sub={t ? formatMinor(t.labourCostMinor) : undefined}
          tone={labourTone}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-medium">{dict.reports.cashVsUpi}</h2>
          {t ? (
            <>
              <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-ink-100">
                {[
                  { key: 'cash', value: t.cashSalesMinor, colour: 'bg-leaf-500' },
                  { key: 'upi', value: t.upiSalesMinor, colour: 'bg-brand-500' },
                  { key: 'card', value: t.cardSalesMinor, colour: 'bg-ink-400' },
                ].map((seg) => {
                  const total = t.cashSalesMinor + t.upiSalesMinor + t.cardSalesMinor || 1;
                  return (
                    <div
                      key={seg.key}
                      className={seg.colour}
                      style={{ width: `${(seg.value / total) * 100}%` }}
                      title={`${seg.key}: ${formatMinor(seg.value)}`}
                    />
                  );
                })}
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-ink-400">{dict.pos.cash}</dt>
                  <dd className="tabular-nums">{formatMinor(t.cashSalesMinor)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-400">UPI</dt>
                  <dd className="tabular-nums">{formatMinor(t.upiSalesMinor)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-400">{dict.pos.card}</dt>
                  <dd className="tabular-nums">{formatMinor(t.cardSalesMinor)}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-400">{dict.common.noData}</p>
          )}
        </Card>

        <Card>
          <h2 className="font-medium">{dict.reports.perSlot}</h2>
          {t && t.slotBreakdown.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm">
              {t.slotBreakdown.map((s) => (
                <li key={s.mealSlot} className="flex items-baseline justify-between border-b border-ink-100 pb-1.5">
                  <span>{s.mealSlot.replace('_', ' ')}</span>
                  <span className="text-ink-400">
                    {s.orders} × <span className="tabular-nums text-ink-800">{formatMinor(s.netMinor)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-400">{dict.common.noData}</p>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="font-medium">{dict.reports.topItems}</h2>
        {t && t.topItems.length > 0 ? (
          <Table head={[dict.common.name, dict.common.qty, dict.reports.revenue]}>
            {t.topItems.map((i) => (
              <tr key={i.menuItemId}>
                <td className="px-3 py-2">{i.name}</td>
                <td className="px-3 py-2 tabular-nums">{i.qty}</td>
                <td className="px-3 py-2 tabular-nums">{formatMinor(i.revenueMinor)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>{dict.common.noData}</Empty>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {can('inventory:read') ? (
          <Card>
            <div className="flex items-baseline justify-between">
              <h2 className="font-medium">{dict.inventory.buyToday}</h2>
              <Link href={`/${locale}/admin/inventory`} className="text-xs text-brand-700 underline">
                {dict.admin.inventory}
              </Link>
            </div>
            {(lowStock.data?.length ?? 0) === 0 ? (
              <p className="mt-2 text-sm text-leaf-600">Nothing below its reorder point.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-sm">
                {(lowStock.data ?? []).slice(0, 8).map((i) => (
                  <li key={i.inventoryItemId} className="flex items-baseline justify-between">
                    <span>{i.name}</span>
                    <span className={i.isOut ? 'text-red-600' : 'text-amber-600'}>
                      {Number(i.onHandQty).toFixed(2)} / {Number(i.reorderPointQty).toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {can('payable:read') ? (
          <Card>
            <div className="flex items-baseline justify-between">
              <h2 className="font-medium">{dict.vendors.dueThisWeek}</h2>
              <Link href={`/${locale}/admin/purchasing`} className="text-xs text-brand-700 underline">
                {dict.admin.purchasing}
              </Link>
            </div>
            {(payables.data?.length ?? 0) === 0 ? (
              <p className="mt-2 text-sm text-leaf-600">Nothing due in the next seven days.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-sm">
                {(payables.data ?? []).slice(0, 8).map((p) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-2">
                    <span className="truncate">{p.vendor.name}</span>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      {p.isOverdue ? <Badge tone="bad">{dict.vendors.overdue}</Badge> : null}
                      <span className="tabular-nums">{formatMinorCompact(p.outstandingMinor)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {can('legal:read') ? (
          <Card>
            <div className="flex items-baseline justify-between">
              <h2 className="font-medium">{dict.admin.legal}</h2>
              <Link href={`/${locale}/admin/legal`} className="text-xs text-brand-700 underline">
                {dict.common.all}
              </Link>
            </div>
            <ul className="mt-2 space-y-1.5 text-sm">
              {(compliance.data?.expired ?? []).map((d) => (
                <li key={d.id} className="flex items-baseline justify-between">
                  <span className="truncate">{d.title}</span>
                  <Badge tone="bad">{dict.legal.expired}</Badge>
                </li>
              ))}
              {(compliance.data?.expiringSoon ?? []).map((d) => (
                <li key={d.id} className="flex items-baseline justify-between">
                  <span className="truncate">{d.title}</span>
                  <Badge tone="warn">{d.daysToExpiry}d</Badge>
                </li>
              ))}
              {(compliance.data?.missing ?? []).map((c) => (
                <li key={c} className="flex items-baseline justify-between text-ink-400">
                  <span className="truncate">{c.replace(/_/g, ' ')}</span>
                  <Badge tone="neutral">missing</Badge>
                </li>
              ))}
              {compliance.data &&
              compliance.data.expired.length + compliance.data.expiringSoon.length + compliance.data.missing.length === 0 ? (
                <li className="text-leaf-600">All documents present and in date.</li>
              ) : null}
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
