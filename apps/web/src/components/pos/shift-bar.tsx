'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formatMinor } from '@mk/shared';
import { Badge, Button, Card, ErrorNote } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useDict } from '@/lib/dict';
import { useSession } from '@/lib/session';
import { Keypad } from './keypad';

interface CashSession {
  id: string;
  openingFloatMinor: number;
  expectedCashMinor: number;
  cashSalesMinor: number;
  orderCount: number;
  grossSalesMinor: number;
}

/**
 * The shift bar.
 *
 * Opening and closing the cash drawer used to live inside the order ticket, which was
 * wrong twice over: it is shift-level state, not order-level, and putting it there pushed
 * the Settle button further down the column all day for no reason. It belongs here — one
 * line, always visible, out of the way of the thing being tapped two hundred times a day.
 */
export function ShiftBar() {
  const dict = useDict();
  const { branchId, can } = useSession();
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<'NONE' | 'OPEN' | 'CLOSE'>('NONE');

  const session = useQuery({
    queryKey: ['cash-session', branchId],
    enabled: !!branchId && can('cash_session:manage'),
    refetchInterval: 60_000,
    queryFn: () => get<CashSession | null>(`/cash-sessions/current?branchId=${branchId}`),
  });

  if (!can('cash_session:manage')) return null;

  const open = session.data;

  return (
    <>
      <div className="border-b border-ink-200 bg-white px-3 py-1.5">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {open ? (
            <>
              <Badge tone="good">{dict.pos.shiftOpen}</Badge>
              <span className="text-ink-600">
                {dict.pos.expectedCash}{' '}
                <strong className="tabular-nums text-ink-900">{formatMinor(open.expectedCashMinor)}</strong>
              </span>
              <span className="hidden text-ink-400 sm:inline">
                {open.orderCount} {dict.reports.orders.toLowerCase()} ·{' '}
                <span className="tabular-nums">{formatMinor(open.grossSalesMinor)}</span>
              </span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setPanel('CLOSE')}>
                {dict.pos.closeDrawer}
              </Button>
            </>
          ) : (
            <>
              <Badge tone="warn">{dict.pos.shiftClosed}</Badge>
              <span className="hidden text-ink-400 sm:inline">{dict.pos.noDrawerWarning}</span>
              <Button variant="leaf" size="sm" className="ml-auto" onClick={() => setPanel('OPEN')}>
                {dict.pos.startShift}
              </Button>
            </>
          )}
        </div>
      </div>

      {panel === 'OPEN' ? (
        <OpenDrawer
          onClose={() => setPanel('NONE')}
          onDone={() => {
            setPanel('NONE');
            void queryClient.invalidateQueries({ queryKey: ['cash-session', branchId] });
          }}
        />
      ) : null}

      {panel === 'CLOSE' && open ? (
        <CloseDrawer
          session={open}
          onClose={() => setPanel('NONE')}
          onDone={() => {
            setPanel('NONE');
            void queryClient.invalidateQueries({ queryKey: ['cash-session', branchId] });
          }}
        />
      ) : null}
    </>
  );
}

function OpenDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const dict = useDict();
  const { branchId } = useSession();
  const [float, setFloat] = useState(200000);

  const mutation = useMutation({
    mutationFn: () => post('/cash-sessions/open', { branchId, openingFloatMinor: float }),
    onSuccess: onDone,
  });

  return (
    <Sheet title={dict.pos.openDrawer} onClose={onClose}>
      <p className="text-sm text-ink-600">
        {dict.pos.openingFloat} — the change you are starting the shift with.
      </p>
      <div className="mt-3">
        <Keypad value={float} onChange={setFloat} />
      </div>
      <ErrorNote error={mutation.error} />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onClose} size="lg">
          {dict.common.cancel}
        </Button>
        <Button variant="leaf" size="lg" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? dict.common.saving : dict.pos.openDrawer}
        </Button>
      </div>
    </Sheet>
  );
}

/**
 * Closing the drawer produces the Z-report. The counted amount is entered on the keypad
 * and the variance is shown before it is committed — a cashier who is ₹500 short should
 * see that and recount, not discover it in a report next week.
 */
function CloseDrawer({
  session,
  onClose,
  onDone,
}: {
  session: CashSession;
  onClose: () => void;
  onDone: () => void;
}) {
  const dict = useDict();
  const [counted, setCounted] = useState(0);
  const [result, setResult] = useState<{ varianceMinor: number } | null>(null);
  const variance = counted - session.expectedCashMinor;

  const mutation = useMutation({
    mutationFn: () =>
      post<{ varianceMinor: number }>('/cash-sessions/close', {
        cashSessionId: session.id,
        countedCashMinor: counted,
      }),
    onSuccess: (res) => setResult(res),
  });

  if (result) {
    return (
      <Sheet title={dict.pos.closeDrawer} onClose={onDone}>
        <div
          className={`rounded-xl px-4 py-5 text-center ${
            result.varianceMinor === 0 ? 'bg-leaf-100' : 'bg-amber-50'
          }`}
        >
          <div className="text-sm font-medium uppercase tracking-wide text-ink-600">
            {dict.pos.variance}
          </div>
          <div
            className={`mt-1 text-4xl font-bold tabular-nums ${
              result.varianceMinor === 0 ? 'text-leaf-600' : 'text-amber-700'
            }`}
          >
            {formatMinor(result.varianceMinor)}
          </div>
          <p className="mt-2 text-sm text-ink-600">
            {result.varianceMinor === 0
              ? 'The drawer balances exactly.'
              : 'Recorded against this shift. A small difference once is a miscount; the same difference every day is a pattern.'}
          </p>
        </div>
        <Button className="mt-4 w-full" size="lg" onClick={onDone}>
          {dict.pos.done}
        </Button>
      </Sheet>
    );
  }

  return (
    <Sheet title={dict.pos.closeDrawer} onClose={onClose}>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-ink-400">{dict.pos.openingFloat}</dt>
          <dd className="tabular-nums">{formatMinor(session.openingFloatMinor)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-400">{dict.pos.expectedCash}</dt>
          <dd className="font-semibold tabular-nums">{formatMinor(session.expectedCashMinor)}</dd>
        </div>
      </dl>

      <p className="mt-3 text-sm text-ink-600">{dict.pos.countedCash}</p>
      <div className="mt-2">
        <Keypad value={counted} onChange={setCounted} />
      </div>

      {counted > 0 ? (
        <div
          className={`mt-3 flex items-baseline justify-between rounded-lg px-3 py-2 ${
            variance === 0 ? 'bg-leaf-100 text-leaf-600' : 'bg-amber-50 text-amber-800'
          }`}
        >
          <span className="font-medium">{dict.pos.variance}</span>
          <span className="text-xl font-bold tabular-nums">{formatMinor(variance)}</span>
        </div>
      ) : null}

      <ErrorNote error={mutation.error} />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onClose} size="lg">
          {dict.common.cancel}
        </Button>
        <Button size="lg" disabled={counted <= 0 || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? dict.common.saving : dict.pos.closeDrawer}
        </Button>
      </div>
    </Sheet>
  );
}

/** A bottom sheet on a phone, a centred dialog on anything larger. */
function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/60 sm:items-center sm:p-4"
      role="dialog"
      aria-modal
      aria-label={title}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <Card className="max-h-[95vh] w-full max-w-sm overflow-y-auto rounded-b-none sm:rounded-xl">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {children}
      </Card>
    </div>
  );
}
