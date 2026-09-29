'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatBp, formatMinor, formatMinorCompact } from '@mk/shared';
import { Badge, Card, Empty, ErrorNote, Field, Stat, Table, inputClass } from '@/components/ui';
import { StaffShell } from '@/components/staff-shell';
import { get } from '@/lib/api';
import { useDict } from '@/lib/dict';
import { useSession } from '@/lib/session';

interface SeriesRow {
  businessDate?: string;
  bucket?: string;
  orderCount: number;
  grossSalesMinor: number;
  netSalesMinor: number;
  cogsMinor: number;
  wastageMinor: number;
  labourCostMinor: number;
  otherExpenseMinor: number;
  cashSalesMinor: number;
  upiSalesMinor: number;
  avgTicketMinor: number;
  foodCostBp: number;
  labourCostBp: number;
}

interface BranchRow {
  branch: { id: string; name: string; code: string };
  orderCount: number;
  grossSalesMinor: number;
  cogsMinor: number;
  labourCostMinor: number;
  wastageMinor: number;
  otherExpenseMinor: number;
  contributionMinor: number;
  foodCostBp: number;
  labourCostBp: number;
}

interface MarginRow {
  menuItemId: string;
  name: string;
  mealSlot: string;
  priceMinor: number;
  costMinor: number;
  foodCostBp: number;
  targetBp: number;
  hasRecipe: boolean;
  overTarget: boolean;
}

interface BreakEven {
  days: number;
  avgTicketMinor: number;
  contributionPerOrderMinor: number;
  fixedCostPerDayMinor: number;
  breakEvenOrdersPerDay: number | null;
  actualOrdersPerDay: number;
}

export default function ReportsPage() {
  return (
    <StaffShell requires="report:cost" title="Reports">
      <Reports />
    </StaffShell>
  );
}

function Reports() {
  const dict = useDict();
  const { branchId, can } = useSession();
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [granularity, setGranularity] = useState<'DAY' | 'WEEK' | 'MONTH'>('DAY');

  const series = useQuery({
    queryKey: ['series', branchId, from, to, granularity],
    enabled: !!branchId,
    queryFn: () =>
      get<SeriesRow[]>(`/reports/series?branchId=${branchId}&from=${from}&to=${to}&granularity=${granularity}`),
  });

  const margins = useQuery({
    queryKey: ['margins', branchId],
    enabled: !!branchId && can('inventory:cost:read'),
    queryFn: () => get<MarginRow[]>(`/inventory/margins/${branchId}`),
  });

  const breakEven = useQuery({
    queryKey: ['break-even', branchId, from, to],
    enabled: !!branchId,
    queryFn: () => get<BreakEven | null>(`/reports/break-even/${branchId}?from=${from}&to=${to}`),
  });

  const branches = useQuery({
    queryKey: ['branch-compare', from, to],
    enabled: can('report:consolidated'),
    queryFn: () => get<BranchRow[]>(`/reports/branches?from=${from}&to=${to}`),
  });

  const rows = series.data ?? [];
  const totals = rows.reduce(
    (acc, r) => ({
      orders: acc.orders + r.orderCount,
      gross: acc.gross + r.grossSalesMinor,
      cogs: acc.cogs + r.cogsMinor,
      labour: acc.labour + r.labourCostMinor,
      wastage: acc.wastage + r.wastageMinor,
      expenses: acc.expenses + r.otherExpenseMinor,
    }),
    { orders: 0, gross: 0, cogs: 0, labour: 0, wastage: 0, expenses: 0 },
  );
  const contribution = totals.gross - totals.cogs - totals.labour - totals.expenses;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={dict.common.from}>
          <input className={inputClass} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={dict.common.to}>
          <input className={inputClass} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Group by">
          <select className={inputClass} value={granularity} onChange={(e) => setGranularity(e.target.value as typeof granularity)}>
            <option value="DAY">Day</option>
            <option value="WEEK">Week</option>
            <option value="MONTH">Month</option>
          </select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={dict.reports.grossSales} value={formatMinor(totals.gross)} sub={`${totals.orders} orders`} />
        <Stat
          label={dict.reports.foodCost}
          value={totals.gross ? formatBp(Math.round((totals.cogs / totals.gross) * 10_000)) : '—'}
          sub={formatMinor(totals.cogs)}
          tone={totals.gross && totals.cogs / totals.gross > 0.35 ? 'bad' : 'good'}
        />
        <Stat
          label={dict.reports.labourCost}
          value={totals.gross ? formatBp(Math.round((totals.labour / totals.gross) * 10_000)) : '—'}
          sub={formatMinor(totals.labour)}
          tone={totals.gross && totals.labour / totals.gross > 0.25 ? 'bad' : 'good'}
        />
        <Stat
          label="Contribution"
          value={formatMinor(contribution)}
          sub={`after food, staff and expenses`}
          tone={contribution < 0 ? 'bad' : 'good'}
        />
      </div>

      {breakEven.data ? (
        <Card>
          <h2 className="font-medium">{dict.reports.breakEven}</h2>
          <p className="mt-1 text-sm text-ink-600">
            At an average bill of {formatMinor(breakEven.data.avgTicketMinor)} and a contribution of{' '}
            {formatMinor(breakEven.data.contributionPerOrderMinor)} per order, fixed costs of{' '}
            {formatMinor(breakEven.data.fixedCostPerDayMinor)} a day need{' '}
            <strong>{breakEven.data.breakEvenOrdersPerDay ?? '—'} orders a day</strong> to break even. You are
            averaging <strong>{breakEven.data.actualOrdersPerDay}</strong>.
          </p>
          {breakEven.data.breakEvenOrdersPerDay !== null ? (
            <div className="mt-3">
              <Badge tone={breakEven.data.actualOrdersPerDay >= breakEven.data.breakEvenOrdersPerDay ? 'good' : 'bad'}>
                {breakEven.data.actualOrdersPerDay >= breakEven.data.breakEvenOrdersPerDay
                  ? 'Above break-even'
                  : `${breakEven.data.breakEvenOrdersPerDay - breakEven.data.actualOrdersPerDay} orders short`}
              </Badge>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <h2 className="font-medium">
          {granularity === 'DAY' ? dict.reports.today : granularity === 'WEEK' ? dict.common.thisWeek : dict.common.thisMonth}{' '}
          series
        </h2>
        <ErrorNote error={series.error} />
        {rows.length === 0 ? (
          <Empty>
            No rollups for this range yet. The nightly job computes them at 00:20 IST; you can also recompute a
            day from the API.
          </Empty>
        ) : (
          <>
            <Sparkline values={rows.map((r) => r.grossSalesMinor)} />
            <Table
              head={[
                dict.common.date,
                dict.reports.orders,
                dict.reports.grossSales,
                dict.reports.cogs,
                dict.reports.foodCost,
                dict.reports.labourCost,
                dict.reports.wastage,
                dict.pos.cash,
                'UPI',
                dict.reports.avgTicket,
              ]}
            >
              {rows.map((r) => {
                const key = r.businessDate?.slice(0, 10) ?? r.bucket ?? '';
                return (
                  <tr key={key}>
                    <td className="px-3 py-2 tabular-nums">{key}</td>
                    <td className="px-3 py-2 tabular-nums">{r.orderCount}</td>
                    <td className="px-3 py-2 tabular-nums font-medium">{formatMinor(r.grossSalesMinor)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMinor(r.cogsMinor)}</td>
                    <td className={`px-3 py-2 tabular-nums ${r.foodCostBp > 3500 ? 'text-red-600' : ''}`}>
                      {formatBp(r.foodCostBp)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{formatBp(r.labourCostBp)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMinor(r.wastageMinor)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMinorCompact(r.cashSalesMinor)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMinorCompact(r.upiSalesMinor)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMinor(r.avgTicketMinor)}</td>
                  </tr>
                );
              })}
            </Table>
          </>
        )}
      </Card>

      {can('inventory:cost:read') ? (
        <Card>
          <h2 className="font-medium">Per-dish food cost</h2>
          <p className="mt-1 text-sm text-ink-600">
            Recipe cost at today&rsquo;s weighted-average ingredient prices, against each dish&rsquo;s target. A
            dish with no recipe shows as a gap to fill, not as a zero.
          </p>
          <Table head={['Dish', 'Slot', 'Price', 'Cost', dict.reports.foodCost, 'Target']}>
            {(margins.data ?? []).map((m) => (
              <tr key={`${m.menuItemId}-${m.mealSlot}`} className={m.overTarget ? 'bg-amber-50' : undefined}>
                <td className="px-3 py-2">
                  {m.name}
                  {!m.hasRecipe ? (
                    <span className="ml-2">
                      <Badge tone="neutral">no recipe</Badge>
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-ink-600">{m.mealSlot.replace('_', ' ').toLowerCase()}</td>
                <td className="px-3 py-2 tabular-nums">{formatMinor(m.priceMinor)}</td>
                <td className="px-3 py-2 tabular-nums">{m.hasRecipe ? formatMinor(m.costMinor) : '—'}</td>
                <td className={`px-3 py-2 tabular-nums font-medium ${m.overTarget ? 'text-amber-700' : ''}`}>
                  {m.hasRecipe ? formatBp(m.foodCostBp) : '—'}
                </td>
                <td className="px-3 py-2 tabular-nums text-ink-400">{formatBp(m.targetBp, 0)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}

      {can('report:consolidated') && (branches.data?.length ?? 0) > 1 ? (
        <Card>
          <h2 className="font-medium">{dict.reports.branchCompare}</h2>
          <Table
            head={[
              dict.common.branch,
              dict.reports.orders,
              dict.reports.grossSales,
              dict.reports.foodCost,
              dict.reports.labourCost,
              'Contribution',
            ]}
          >
            {(branches.data ?? []).map((b) => (
              <tr key={b.branch.id}>
                <td className="px-3 py-2 font-medium">{b.branch.name}</td>
                <td className="px-3 py-2 tabular-nums">{b.orderCount}</td>
                <td className="px-3 py-2 tabular-nums">{formatMinor(b.grossSalesMinor)}</td>
                <td className="px-3 py-2 tabular-nums">{formatBp(b.foodCostBp)}</td>
                <td className="px-3 py-2 tabular-nums">{formatBp(b.labourCostBp)}</td>
                <td className={`px-3 py-2 tabular-nums font-medium ${b.contributionMinor < 0 ? 'text-red-600' : ''}`}>
                  {formatMinor(b.contributionMinor)}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * A bare inline sparkline.
 *
 * No chart library: one 40-line SVG against 30 data points, versus 90 KB of JavaScript
 * shipped to a tablet on a 4G tether. When the reports genuinely need axes and tooltips,
 * that is the moment to add a library — not before.
 */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const width = 600;
  const height = 60;
  const step = width / (values.length - 1);
  const points = values.map((v, i) => `${i * step},${height - (v / max) * (height - 6) - 3}`).join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mt-3 h-16 w-full"
      role="img"
      aria-label={`Sales trend across ${values.length} periods`}
      preserveAspectRatio="none"
    >
      <polyline points={points} fill="none" stroke="var(--color-brand-500)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <polyline
        points={`0,${height} ${points} ${width},${height}`}
        fill="var(--color-brand-100)"
        stroke="none"
        opacity="0.6"
      />
    </svg>
  );
}
