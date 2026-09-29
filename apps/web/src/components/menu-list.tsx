'use client';

import { useMemo, useState } from 'react';
import { MEAL_SLOTS, formatMinor, pickI18n } from '@mk/shared';
import type { PublicMenuCategory } from '@/lib/server-api';
import { useDict, useLocale } from '@/lib/dict';
import { useCart } from '@/lib/cart';
import { Badge, Button } from './ui';

const SLOT_ORDER = ['LUNCH', 'CHAI', 'EVENING', 'ALL_DAY'] as const;

/**
 * The menu, grouped by meal slot rather than shown as one long list.
 *
 * Grouping matters because the same shop sells three different things at three different
 * times, and a customer at 6 pm looking at a lunch thali they cannot order is a customer
 * who leaves.
 */
export function MenuList({
  categories,
  initialSlot,
  canOrder = false,
  branchId,
}: {
  categories: PublicMenuCategory[];
  initialSlot?: string;
  canOrder?: boolean;
  branchId?: string;
}) {
  const dict = useDict();
  const locale = useLocale();
  const cart = useCart();
  const [slot, setSlot] = useState<string>(initialSlot ?? 'ALL');

  const slotsPresent = useMemo(() => {
    const set = new Set<string>();
    for (const c of categories) for (const i of c.items) for (const v of i.variants) set.add(v.mealSlot);
    return SLOT_ORDER.filter((s) => set.has(s));
  }, [categories]);

  const visible = useMemo(() => {
    if (slot === 'ALL') return categories;
    return categories
      .map((c) => ({
        ...c,
        items: c.items
          .map((i) => ({ ...i, variants: i.variants.filter((v) => v.mealSlot === slot || v.mealSlot === 'ALL_DAY') }))
          .filter((i) => i.variants.length > 0),
      }))
      .filter((c) => c.items.length > 0);
  }, [categories, slot]);

  const slotLabel = (s: string) =>
    ({
      LUNCH: dict.home.todayTitle.replace("Today's ", '').replace('आज की ', '').replace('ఈ రోజు ', ''),
      CHAI: dict.menu.all,
      EVENING: dict.menu.all,
      ALL_DAY: dict.menu.all,
    })[s] ?? s;

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2">
        <SlotTab active={slot === 'ALL'} onClick={() => setSlot('ALL')}>
          {dict.menu.all}
        </SlotTab>
        {slotsPresent.map((s) => (
          <SlotTab key={s} active={slot === s} onClick={() => setSlot(s)}>
            {SLOT_LABELS[s][locale] ?? s}
          </SlotTab>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-200 p-8 text-center text-ink-400">
          {dict.menu.empty}
        </p>
      ) : null}

      <div className="space-y-10">
        {visible.map((category) => (
          <section key={category.id} aria-labelledby={`cat-${category.slug}`}>
            <h2
              id={`cat-${category.slug}`}
              className="mb-3 font-display text-xl font-semibold text-brand-800"
            >
              {pickI18n(category.name, category.nameI18n, locale)}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {category.items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-xl border border-ink-200 bg-white p-4 transition-shadow hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-ink-900">{pickI18n(item.name, item.nameI18n, locale)}</h3>
                      {item.description ? (
                        <p className="mt-1 text-sm text-ink-600">
                          {pickI18n(item.description, item.descriptionI18n, locale)}
                        </p>
                      ) : null}
                    </div>
                    <FoodTypeDot type={item.foodType} label={dict.menu[item.foodType === 'VEG' ? 'veg' : item.foodType === 'NON_VEG' ? 'nonVeg' : item.foodType === 'EGG' ? 'egg' : 'jain']} />
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.isLessOil ? <Badge tone="good">{dict.menu.lessOil}</Badge> : null}
                    {item.isMithilaSpecial ? <Badge tone="brand">{dict.menu.mithilaSpecial}</Badge> : null}
                    {item.isChefSpecial ? <Badge tone="warn">{dict.menu.chefSpecial}</Badge> : null}
                  </div>

                  <div className="mt-3 space-y-2">
                    {item.variants.map((v) => (
                      <div key={v.branchMenuItemId} className="flex items-center justify-between gap-3">
                        <span className="text-sm text-ink-600">
                          {pickI18n(v.name, v.nameI18n, locale)}
                          {v.isSoldOut ? (
                            <span className="ml-2 text-xs font-medium text-red-600">{dict.menu.soldOut}</span>
                          ) : null}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-medium tabular-nums">{formatMinor(v.priceMinor)}</span>
                          {canOrder && branchId ? (
                            <Button
                              size="sm"
                              disabled={v.isSoldOut}
                              onClick={() =>
                                cart.add({
                                  variantId: v.variantId,
                                  name: pickI18n(item.name, item.nameI18n, locale),
                                  variantName: pickI18n(v.name, v.nameI18n, locale),
                                  priceMinor: v.priceMinor,
                                  mealSlot: v.mealSlot,
                                  branchId,
                                })
                              }
                            >
                              {dict.menu.addToCart}
                            </Button>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

const SLOT_LABELS: Record<string, Record<string, string>> = {
  LUNCH: { en: 'Lunch thali', hi: 'दोपहर की थाली', te: 'మధ్యాహ్నం థాలీ' },
  CHAI: { en: 'Chai & snacks', hi: 'चाय और नाश्ता', te: 'చాయ్ & స్నాక్స్' },
  EVENING: { en: 'Evening Chinese', hi: 'शाम — चाइनीज़', te: 'సాయంత్రం చైనీస్' },
  ALL_DAY: { en: 'All day', hi: 'दिन भर', te: 'రోజంతా' },
};

function SlotTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`pos-tap rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-brand-600 text-white' : 'border border-ink-200 bg-white text-ink-600 hover:bg-ink-50'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The green/brown square is the Indian veg/non-veg mark. It is a legal labelling
 * convention here and customers scan for it before they read anything else.
 */
function FoodTypeDot({ type, label }: { type: string; label: string }) {
  const colour =
    type === 'VEG' || type === 'JAIN' ? 'border-leaf-500 text-leaf-500' : type === 'EGG' ? 'border-amber-500 text-amber-500' : 'border-red-600 text-red-600';
  return (
    <span title={label} aria-label={label} className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center border-2 ${colour}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
    </span>
  );
}
