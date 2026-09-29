'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { KITCHEN_STATIONS } from '@mk/shared';
import { Badge, Button, Card, Empty, ErrorNote } from '@/components/ui';
import { StaffShell } from '@/components/staff-shell';
import { get, patch } from '@/lib/api';
import { useDict } from '@/lib/dict';
import { useSession } from '@/lib/session';

interface Ticket {
  id: string;
  station: string;
  ticketNo: number;
  createdAt: string;
  readyAt: string | null;
  items: { id: string; qty: number; notes: string | null; orderItem: { nameSnapshot: string; variantSnapshot: string; notes: string | null } }[];
  order: { id: string; tokenNo: number; channel: string; createdAt: string; notes: string | null; table: { label: string } | null };
}

export default function KitchenPage() {
  return (
    <StaffShell requires="kitchen:read" title="Kitchen" wide>
      <Kitchen />
    </StaffShell>
  );
}

/**
 * The kitchen display.
 *
 * Big type, high contrast, and one action per ticket — it is read from two metres away
 * by someone with their hands full. Tickets are ordered oldest-first and tinted by age,
 * because the only thing the kitchen needs to know is what has been waiting longest.
 */
function Kitchen() {
  const dict = useDict();
  const { branchId, can } = useSession();
  const [station, setStation] = useState<string>('ALL');

  const query = useQuery({
    queryKey: ['kitchen', branchId, station],
    enabled: !!branchId,
    // Polling rather than websockets: one shop, five tickets, and a polling loop that
    // recovers from a dropped connection by itself.
    refetchInterval: 8_000,
    queryFn: () =>
      get<Ticket[]>(`/orders/kitchen?branchId=${branchId}${station === 'ALL' ? '' : `&station=${station}`}`),
  });

  async function markReady(orderId: string) {
    await patch('/orders/status', { orderId, status: 'READY' });
    await query.refetch();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {['ALL', ...KITCHEN_STATIONS].map((s) => (
          <button
            key={s}
            onClick={() => setStation(s)}
            className={`pos-tap rounded-lg px-4 py-2 font-semibold ${
              station === s ? 'bg-ink-800 text-white' : 'border border-ink-200 bg-white text-ink-600'
            }`}
          >
            {s === 'ALL' ? dict.common.all : s}
          </button>
        ))}
      </div>

      <ErrorNote error={query.error} />

      {(query.data?.length ?? 0) === 0 ? (
        <Empty>{dict.common.noData}</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {(query.data ?? []).map((t) => {
            const minutes = Math.floor((Date.now() - new Date(t.order.createdAt).getTime()) / 60_000);
            const tone = minutes >= 20 ? 'border-red-400 bg-red-50' : minutes >= 10 ? 'border-amber-400 bg-amber-50' : 'border-ink-200 bg-white';
            return (
              <Card key={t.id} className={`!border-2 ${tone}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-3xl font-bold tabular-nums">#{t.order.tokenNo}</div>
                    <div className="text-xs text-ink-400">
                      {t.order.table ? `Table ${t.order.table.label}` : t.order.channel.replace('_', ' ')}
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge tone={minutes >= 20 ? 'bad' : minutes >= 10 ? 'warn' : 'neutral'}>{minutes}m</Badge>
                    <div className="mt-1 text-xs text-ink-400">{t.station}</div>
                  </div>
                </div>

                <ul className="mt-3 space-y-1.5">
                  {t.items.map((i) => (
                    <li key={i.id} className="text-lg leading-tight">
                      <span className="font-bold tabular-nums">{i.qty}×</span> {i.orderItem.nameSnapshot}
                      {i.orderItem.variantSnapshot !== 'Regular' ? (
                        <span className="text-ink-400"> ({i.orderItem.variantSnapshot})</span>
                      ) : null}
                      {i.orderItem.notes ? (
                        <div className="text-sm font-medium text-brand-700">↳ {i.orderItem.notes}</div>
                      ) : null}
                    </li>
                  ))}
                </ul>

                {t.order.notes ? (
                  <p className="mt-2 rounded bg-brand-50 px-2 py-1 text-sm text-brand-800">{t.order.notes}</p>
                ) : null}

                {can('kitchen:update') ? (
                  <Button variant="leaf" size="lg" className="mt-3 w-full" onClick={() => void markReady(t.order.id)}>
                    {dict.pos.ready}
                  </Button>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
