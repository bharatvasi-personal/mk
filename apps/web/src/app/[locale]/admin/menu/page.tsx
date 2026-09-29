'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { MEAL_SLOTS, formatMinor, pickI18n } from '@mk/shared';
import { Badge, Button, Card, Empty, ErrorNote, Field, Table, inputClass } from '@/components/ui';
import { StaffShell } from '@/components/staff-shell';
import { get, patch, put } from '@/lib/api';
import { useDict, useLocale } from '@/lib/dict';
import { useSession } from '@/lib/session';
import type { PublicMenuCategory } from '@/lib/server-api';

export default function MenuAdminPage() {
  return (
    <StaffShell requires="menu:write" title="Menu">
      <MenuAdmin />
    </StaffShell>
  );
}

/**
 * Menu and price management.
 *
 * Prices live per branch × variant × meal slot, so this screen edits the *branch's*
 * price, not the catalogue's. That is the split that makes opening branch #2 a morning of
 * data entry instead of a schema migration.
 *
 * "Sold out" is the most-used control here after 1:30 pm: a 12x18 kitchen genuinely runs
 * out of thali, and the online store has to stop selling it the moment it does.
 */
function MenuAdmin() {
  const dict = useDict();
  const locale = useLocale();
  const { branchId, can } = useSession();
  const queryClient = useQueryClient();
  const [slot, setSlot] = useState<string>('LUNCH');
  const [editing, setEditing] = useState<{ branchMenuItemId: string; variantId: string; name: string; priceMinor: number } | null>(
    null,
  );

  const menu = useQuery({
    queryKey: ['admin-menu', branchId, slot],
    enabled: !!branchId,
    queryFn: () => get<PublicMenuCategory[]>(`/menu/branch/${branchId}?mealSlot=${slot}&includeUnavailable=true`),
  });

  const soldOut = useMutation({
    mutationFn: (vars: { branchMenuItemId: string; soldOut: boolean }) =>
      patch('/menu/sold-out', {
        branchMenuItemId: vars.branchMenuItemId,
        // Sold out until end of trading; the nightly job clears it so the menu opens clean.
        soldOutUntil: vars.soldOut ? endOfTradingDay().toISOString() : null,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-menu', branchId, slot] }),
  });

  const price = useMutation({
    mutationFn: (vars: { variantId: string; priceMinor: number }) =>
      put('/menu/prices', {
        branchId,
        variantId: vars.variantId,
        mealSlot: slot,
        priceMinor: vars.priceMinor,
        gstRateBp: 500,
        isAvailable: true,
      }),
    onSuccess: () => {
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-menu', branchId, slot] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {MEAL_SLOTS.map((s) => (
          <button
            key={s}
            onClick={() => setSlot(s)}
            className={`pos-tap rounded-lg px-4 py-2 text-sm font-semibold ${
              slot === s ? 'bg-brand-600 text-white' : 'border border-ink-200 bg-white text-ink-600'
            }`}
          >
            {s.replace('_', ' ').toLowerCase()}
          </button>
        ))}
      </div>

      <ErrorNote error={menu.error} />
      <ErrorNote error={soldOut.error} />

      {(menu.data?.length ?? 0) === 0 ? (
        <Empty>Nothing priced for this meal slot yet.</Empty>
      ) : (
        (menu.data ?? []).map((category) => (
          <Card key={category.id}>
            <h2 className="font-display text-lg font-semibold text-brand-800">
              {pickI18n(category.name, category.nameI18n, locale)}
            </h2>
            <Table
              head={[
                dict.common.name,
                'Variant',
                'Price',
                'Limit',
                dict.common.status,
                ...(can('menu:price:write') ? [dict.common.actions] : []),
              ]}
            >
              {category.items.flatMap((item) =>
                item.variants.map((v) => (
                  <tr key={v.branchMenuItemId}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{pickI18n(item.name, item.nameI18n, locale)}</div>
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {item.isLessOil ? <Badge tone="good">{dict.menu.lessOil}</Badge> : null}
                        {item.isMithilaSpecial ? <Badge tone="brand">{dict.menu.mithilaSpecial}</Badge> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-ink-600">{pickI18n(v.name, v.nameI18n, locale)}</td>
                    <td className="px-3 py-2 font-medium tabular-nums">{formatMinor(v.priceMinor)}</td>
                    <td className="px-3 py-2 tabular-nums text-ink-400">{v.dailyLimit ?? '—'}</td>
                    <td className="px-3 py-2">
                      {v.isSoldOut ? <Badge tone="bad">{dict.menu.soldOut}</Badge> : <Badge tone="good">available</Badge>}
                    </td>
                    {can('menu:price:write') ? (
                      <td className="px-3 py-2">
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            variant={v.isSoldOut ? 'leaf' : 'secondary'}
                            disabled={soldOut.isPending}
                            onClick={() => soldOut.mutate({ branchMenuItemId: v.branchMenuItemId, soldOut: !v.isSoldOut })}
                          >
                            {v.isSoldOut ? 'Back on' : dict.menu.soldOut}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setEditing({
                                branchMenuItemId: v.branchMenuItemId,
                                variantId: v.variantId,
                                name: `${pickI18n(item.name, item.nameI18n, locale)} · ${v.name}`,
                                priceMinor: v.priceMinor,
                              })
                            }
                          >
                            {dict.common.edit}
                          </Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                )),
              )}
            </Table>
          </Card>
        ))
      )}

      {editing ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-ink-900/50 p-4">
          <Card className="w-full max-w-sm">
            <h2 className="font-display text-lg font-semibold">{editing.name}</h2>
            <p className="text-sm text-ink-400">
              Price for this branch at {slot.replace('_', ' ').toLowerCase()}. Every change is recorded in the
              audit trail with who made it.
            </p>
            <Field label="Price (GST inclusive)">
              <input
                className={`${inputClass} text-right text-xl`}
                type="number"
                step="1"
                value={editing.priceMinor / 100}
                onChange={(e) => setEditing({ ...editing, priceMinor: Math.round(Number(e.target.value) * 100) })}
                autoFocus
              />
            </Field>
            <ErrorNote error={price.error} />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>
                {dict.common.cancel}
              </Button>
              <Button
                disabled={price.isPending || editing.priceMinor <= 0}
                onClick={() => price.mutate({ variantId: editing.variantId, priceMinor: editing.priceMinor })}
              >
                {price.isPending ? dict.common.saving : dict.common.save}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

/** 23:59 IST today — "sold out for the rest of today", which is what staff mean. */
function endOfTradingDay(): Date {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  ist.setHours(23, 59, 0, 0);
  return new Date(ist.getTime() - ist.getTimezoneOffset() * 60_000 + now.getTimezoneOffset() * 60_000);
}
