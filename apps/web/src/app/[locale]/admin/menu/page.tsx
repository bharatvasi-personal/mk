'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FOOD_TYPES, MEAL_SLOTS, formatBp, formatMinor, pickI18n } from '@mk/shared';
import { Badge, Button, Card, Empty, ErrorNote, Table } from '@/components/ui';
import {
  CheckField,
  DangerAction,
  FormDialog,
  FormGrid,
  FormSection,
  FullWidth,
  MoneyField,
  NumberField,
  SelectField,
  Tabs,
  TextField,
  Toolbar,
} from '@/components/admin/form';
import { StaffShell } from '@/components/staff-shell';
import { get, getAccessToken, patch, post, put } from '@/lib/api';
import { useDict, useLocale } from '@/lib/dict';
import { useSession } from '@/lib/session';
import type { PublicMenuCategory } from '@/lib/server-api';

interface Category {
  id: string;
  name: string;
  nameI18n: Record<string, string> | null;
  slug: string;
  mealSlot: string;
  sortOrder: number;
  isActive: boolean;
}

interface MenuItemFull {
  id: string;
  categoryId: string;
  name: string;
  nameI18n: Record<string, string> | null;
  slug: string;
  description: string | null;
  descriptionI18n: Record<string, string> | null;
  foodType: string;
  isLessOil: boolean;
  isMithilaSpecial: boolean;
  isChefSpecial: boolean;
  targetFoodCostPct: number | null;
  sortOrder: number;
  isActive: boolean;
  variants: { id: string; name: string; isDefault: boolean; sortOrder: number; isActive: boolean }[];
  category: { id: string; name: string };
  _count: { recipes: number };
}

interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  avgCostMinor: number;
  uom: { id: string; code: string };
}

interface Uom {
  id: string;
  code: string;
  name: string;
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

type Tab = 'ITEMS' | 'CATEGORIES' | 'RECIPES';

export default function MenuAdminPage() {
  return (
    <StaffShell requires="menu:read" title="Menu">
      <MenuAdmin />
    </StaffShell>
  );
}

function MenuAdmin() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('ITEMS');

  return (
    <div className="space-y-4">
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'ITEMS', label: 'Dishes & prices' },
          { value: 'CATEGORIES', label: 'Categories' },
          { value: 'RECIPES', label: 'Recipes & cost' },
        ]}
      />
      {tab === 'ITEMS' ? <Items /> : null}
      {tab === 'CATEGORIES' ? <Categories /> : null}
      {tab === 'RECIPES' ? (can('recipe:read') ? <Recipes /> : <Empty>No access</Empty>) : null}
    </div>
  );
}

// ─── Dishes ──────────────────────────────────────────────────────────────────

/**
 * The dish list.
 *
 * Note what "remove" means here: a dish is deactivated, never deleted. Bills from last
 * month reference it, the stock ledger references it, and deleting the row would orphan
 * both. Deactivating takes it off the menu and out of the POS immediately, which is what
 * anyone asking to "remove it" actually wants.
 */
function Items() {
  const dict = useDict();
  const locale = useLocale();
  const { branchId, can } = useSession();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<MenuItemFull | 'NEW' | null>(null);
  const [slot, setSlot] = useState('LUNCH');
  const [search, setSearch] = useState('');
  const [showRemoved, setShowRemoved] = useState(false);

  const items = useQuery({
    queryKey: ['menu-items', search, showRemoved],
    queryFn: () =>
      get<MenuItemFull[]>(
        `/menu/items?${new URLSearchParams({
          ...(search ? { search } : {}),
          ...(showRemoved ? { includeInactive: 'true' } : {}),
        })}`,
      ),
  });

  const priced = useQuery({
    queryKey: ['admin-menu', branchId, slot],
    enabled: !!branchId,
    queryFn: () =>
      get<PublicMenuCategory[]>(`/menu/branch/${branchId}?mealSlot=${slot}&includeUnavailable=true`),
  });

  // Price and sold-out state live per branch × variant × slot, so they are looked up
  // from the priced view rather than from the catalogue item.
  const priceFor = new Map<string, { priceMinor: number; isSoldOut: boolean; branchMenuItemId: string }>();
  for (const c of priced.data ?? []) {
    for (const i of c.items) {
      for (const v of i.variants) {
        priceFor.set(v.variantId, {
          priceMinor: v.priceMinor,
          isSoldOut: v.isSoldOut,
          branchMenuItemId: v.branchMenuItemId,
        });
      }
    }
  }

  const soldOut = useMutation({
    mutationFn: (vars: { branchMenuItemId: string; soldOut: boolean }) =>
      patch('/menu/sold-out', {
        branchMenuItemId: vars.branchMenuItemId,
        soldOutUntil: vars.soldOut ? endOfTradingDay().toISOString() : null,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-menu', branchId, slot] }),
  });

  return (
    <div className="space-y-3">
      <Toolbar>
        {can('menu:write') ? <Button onClick={() => setEditing('NEW')}>+ Add a dish</Button> : null}
        {can('menu:write') ? <PublishButton /> : null}
        <SlotPicker value={slot} onChange={setSlot} />
        <label className="flex items-center gap-2 text-sm text-ink-600">
          <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />
          Show removed
        </label>
        <input
          className="ml-auto w-48 rounded-lg border border-ink-200 px-3 py-2 text-sm"
          placeholder={dict.common.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Toolbar>

      <p className="text-sm text-ink-400">
        Prices are per branch and per meal slot — the same dish can cost differently at lunch and in the
        evening, and at another branch.
      </p>

      <ErrorNote error={items.error} />
      <ErrorNote error={soldOut.error} />

      {(items.data?.length ?? 0) === 0 ? (
        <Empty>No dishes yet. Add one, or bulk-import the whole menu from a spreadsheet.</Empty>
      ) : (
        <Table
          head={[
            'Dish',
            'Category',
            'Variants & price',
            'Recipe',
            dict.common.status,
            ...(can('menu:write') ? [dict.common.actions] : []),
          ]}
        >
          {(items.data ?? []).map((item) => (
            <tr key={item.id} className={item.isActive ? undefined : 'opacity-50'}>
              <td className="px-3 py-2">
                <div className="font-medium">{pickI18n(item.name, item.nameI18n, locale)}</div>
                <div className="flex flex-wrap gap-1 pt-0.5">
                  <FoodTypeBadge type={item.foodType} />
                  {item.isLessOil ? <Badge tone="good">{dict.menu.lessOil}</Badge> : null}
                  {item.isMithilaSpecial ? <Badge tone="brand">{dict.menu.mithilaSpecial}</Badge> : null}
                </div>
              </td>
              <td className="px-3 py-2 text-ink-600">{item.category.name}</td>
              <td className="px-3 py-2">
                {item.variants
                  .filter((v) => v.isActive)
                  .map((v) => {
                    const p = priceFor.get(v.id);
                    return (
                      <div key={v.id} className="flex items-center gap-2 py-0.5 text-sm">
                        <span className="text-ink-600">{v.name}</span>
                        <span className="font-medium tabular-nums">
                          {p ? formatMinor(p.priceMinor) : <span className="text-ink-400">not priced</span>}
                        </span>
                        {p?.isSoldOut ? <Badge tone="bad">sold out</Badge> : null}
                        {can('menu:price:write') && p ? (
                          <button
                            className="text-xs text-brand-700 underline"
                            onClick={() =>
                              soldOut.mutate({ branchMenuItemId: p.branchMenuItemId, soldOut: !p.isSoldOut })
                            }
                          >
                            {p.isSoldOut ? 'back on' : 'sold out'}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
              </td>
              <td className="px-3 py-2">
                {item._count.recipes > 0 ? (
                  <Badge tone="good">costed</Badge>
                ) : (
                  <Badge tone="neutral">no recipe</Badge>
                )}
              </td>
              <td className="px-3 py-2">
                {item.isActive ? <Badge tone="good">on the menu</Badge> : <Badge tone="neutral">removed</Badge>}
              </td>
              {can('menu:write') ? (
                <td className="px-3 py-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(item)}>
                    {dict.common.edit}
                  </Button>
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      )}

      {editing ? (
        <ItemDialog
          item={editing === 'NEW' ? null : editing}
          slot={slot}
          existingPrices={priceFor}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['menu-items'] });
            void queryClient.invalidateQueries({ queryKey: ['admin-menu'] });
          }}
        />
      ) : null}
    </div>
  );
}

function ItemDialog({
  item,
  slot,
  existingPrices,
  onClose,
  onDone,
}: {
  item: MenuItemFull | null;
  slot: string;
  existingPrices: Map<string, { priceMinor: number }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { branchId } = useSession();
  const categories = useQuery({ queryKey: ['menu-categories'], queryFn: () => get<Category[]>('/menu/categories') });

  const [form, setForm] = useState({
    categoryId: item?.categoryId ?? '',
    name: item?.name ?? '',
    nameHi: item?.nameI18n?.['hi'] ?? '',
    nameTe: item?.nameI18n?.['te'] ?? '',
    description: item?.description ?? '',
    foodType: item?.foodType ?? 'VEG',
    isLessOil: item?.isLessOil ?? false,
    isMithilaSpecial: item?.isMithilaSpecial ?? false,
    isChefSpecial: item?.isChefSpecial ?? false,
    targetFoodCostPct: String(item?.targetFoodCostPct ?? 32),
    isActive: item?.isActive ?? true,
  });

  const [variants, setVariants] = useState(
    item?.variants.filter((v) => v.isActive).map((v) => ({
      id: v.id as string | undefined,
      name: v.name,
      isDefault: v.isDefault,
      priceMinor: existingPrices.get(v.id)?.priceMinor ?? 0,
    })) ?? [{ id: undefined, name: 'Regular', isDefault: true, priceMinor: 0 }],
  );

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        categoryId: form.categoryId,
        name: form.name.trim(),
        nameI18n: Object.fromEntries(
          [
            ['hi', form.nameHi.trim()],
            ['te', form.nameTe.trim()],
          ].filter(([, v]) => v),
        ),
        description: form.description || undefined,
        descriptionI18n: {},
        foodType: form.foodType,
        isLessOil: form.isLessOil,
        isMithilaSpecial: form.isMithilaSpecial,
        isChefSpecial: form.isChefSpecial,
        targetFoodCostPct: Number(form.targetFoodCostPct) || undefined,
        allergens: [],
        sortOrder: item?.sortOrder ?? 0,
        isActive: form.isActive,
        variants: variants.map((v, i) => ({
          id: v.id,
          name: v.name.trim(),
          nameI18n: {},
          isDefault: v.isDefault,
          sortOrder: i,
        })),
      };

      const saved = item
        ? await put<MenuItemFull>(`/menu/items/${item.id}`, body)
        : await post<MenuItemFull>('/menu/items', body);

      // Prices are a separate call per variant because they belong to the branch, not to
      // the catalogue. Matching by name keeps newly created variants aligned with the
      // price typed against them in this form.
      for (const v of variants) {
        if (v.priceMinor <= 0) continue;
        const savedVariant = saved.variants.find((sv) => sv.name === v.name.trim());
        if (!savedVariant) continue;
        await put('/menu/prices', {
          branchId,
          variantId: savedVariant.id,
          mealSlot: slot,
          priceMinor: v.priceMinor,
          gstRateBp: 500,
          isAvailable: true,
        });
      }
      return saved;
    },
    onSuccess: onDone,
  });

  const removeItem = useMutation({
    mutationFn: () =>
      put(`/menu/items/${item!.id}`, {
        categoryId: item!.categoryId,
        name: item!.name,
        nameI18n: item!.nameI18n ?? {},
        descriptionI18n: {},
        foodType: item!.foodType,
        isLessOil: item!.isLessOil,
        isMithilaSpecial: item!.isMithilaSpecial,
        isChefSpecial: item!.isChefSpecial,
        allergens: [],
        sortOrder: item!.sortOrder,
        isActive: false,
        variants: item!.variants.map((v) => ({
          id: v.id,
          name: v.name,
          nameI18n: {},
          isDefault: v.isDefault,
          sortOrder: v.sortOrder,
        })),
      }),
    onSuccess: onDone,
  });

  const valid = form.name.trim() && form.categoryId && variants.every((v) => v.name.trim());

  return (
    <FormDialog
      title={item ? `Edit ${item.name}` : 'Add a dish'}
      subtitle={`Prices below are for this branch, at ${slot.replace('_', ' ').toLowerCase()}.`}
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending || removeItem.isPending}
      error={mutation.error ?? removeItem.error}
      submitDisabled={!valid}
      wide
      danger={
        item && item.isActive ? (
          <DangerAction
            label="Remove from menu"
            confirmLabel="Remove"
            question="Take it off the menu?"
            busy={removeItem.isPending}
            onConfirm={() => removeItem.mutate()}
          />
        ) : undefined
      }
    >
      <FormGrid>
        <TextField label="Dish name" value={form.name} onChange={(v) => set('name', v)} required autoFocus={!item} />
        <SelectField
          label="Category"
          value={form.categoryId}
          onChange={(v) => set('categoryId', v)}
          required
          placeholder="Choose…"
          options={(categories.data ?? [])
            .filter((c) => c.isActive)
            .map((c) => ({ value: c.id, label: `${c.name} (${c.mealSlot.replace('_', ' ').toLowerCase()})` }))}
        />
        <TextField label="Hindi name" value={form.nameHi} onChange={(v) => set('nameHi', v)} hint="Shown on /hi" />
        <TextField label="Telugu name" value={form.nameTe} onChange={(v) => set('nameTe', v)} hint="Shown on /te" />
        <FullWidth>
          <TextField
            label="Description"
            value={form.description}
            onChange={(v) => set('description', v)}
            placeholder="Rice, dal, two seasonal vegetables, roti, salad"
            hint="Appears on the public menu"
          />
        </FullWidth>
        <SelectField
          label="Food type"
          value={form.foodType}
          onChange={(v) => set('foodType', v)}
          options={FOOD_TYPES.map((f) => ({ value: f, label: f.replace('_', '-').toLowerCase() }))}
        />
        <NumberField
          label="Target food cost"
          value={form.targetFoodCostPct}
          onChange={(v) => set('targetFoodCostPct', v)}
          min={1}
          max={100}
          suffix="%"
          hint="Flagged in reports when the recipe cost goes above this"
        />
      </FormGrid>

      <FormSection title="Badges" hint="These are the brand claims customers scan for.">
        <div className="grid gap-2 sm:grid-cols-3">
          <CheckField label="Less oil" checked={form.isLessOil} onChange={(v) => set('isLessOil', v)} />
          <CheckField label="Mithila special" checked={form.isMithilaSpecial} onChange={(v) => set('isMithilaSpecial', v)} />
          <CheckField label="Chef's special" checked={form.isChefSpecial} onChange={(v) => set('isChefSpecial', v)} />
        </div>
      </FormSection>

      <FormSection
        title="Sizes and prices"
        hint='Every dish needs at least one. Use "Regular" if it comes one way only. Prices include GST.'
      >
        {variants.map((v, index) => (
          <div key={index} className="grid grid-cols-[1fr_8rem_auto_2.5rem] items-end gap-2">
            <TextField
              label={index === 0 ? 'Size' : ''}
              value={v.name}
              onChange={(name) => setVariants((vs) => vs.map((x, i) => (i === index ? { ...x, name } : x)))}
            />
            <MoneyField
              label={index === 0 ? 'Price' : ''}
              minor={v.priceMinor}
              onChange={(priceMinor) =>
                setVariants((vs) => vs.map((x, i) => (i === index ? { ...x, priceMinor } : x)))
              }
            />
            <label className="flex items-center gap-1 pb-2 text-xs text-ink-600">
              <input
                type="radio"
                name="default-variant"
                checked={v.isDefault}
                onChange={() => setVariants((vs) => vs.map((x, i) => ({ ...x, isDefault: i === index })))}
              />
              default
            </label>
            <Button
              type="button"
              variant="ghost"
              className="mb-1"
              onClick={() => setVariants((vs) => (vs.length === 1 ? vs : vs.filter((_, i) => i !== index)))}
              aria-label="Remove size"
            >
              ✕
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setVariants((vs) => [...vs, { id: undefined, name: '', isDefault: false, priceMinor: 0 }])}
        >
          + Add a size
        </Button>
        <p className="text-xs text-ink-400">
          Removing a size here deactivates it — old bills that used it keep working.
        </p>
      </FormSection>
    </FormDialog>
  );
}

// ─── Categories ──────────────────────────────────────────────────────────────

function Categories() {
  const dict = useDict();
  const locale = useLocale();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Category | 'NEW' | null>(null);

  const query = useQuery({ queryKey: ['menu-categories'], queryFn: () => get<Category[]>('/menu/categories') });

  return (
    <div className="space-y-3">
      <Toolbar>
        {can('menu:write') ? <Button onClick={() => setEditing('NEW')}>+ Add a category</Button> : null}
        <span className="text-sm text-ink-400">
          Categories group the menu and decide which meal slot a dish belongs to.
        </span>
      </Toolbar>

      <ErrorNote error={query.error} />

      <Table head={[dict.common.name, 'Meal slot', 'Order', dict.common.status, ...(can('menu:write') ? [dict.common.actions] : [])]}>
        {(query.data ?? []).map((c) => (
          <tr key={c.id} className={c.isActive ? undefined : 'opacity-50'}>
            <td className="px-3 py-2">
              <div className="font-medium">{pickI18n(c.name, c.nameI18n, locale)}</div>
              <div className="text-xs text-ink-400">{c.slug}</div>
            </td>
            <td className="px-3 py-2">{c.mealSlot.replace('_', ' ').toLowerCase()}</td>
            <td className="px-3 py-2 tabular-nums">{c.sortOrder}</td>
            <td className="px-3 py-2">
              {c.isActive ? <Badge tone="good">shown</Badge> : <Badge tone="neutral">hidden</Badge>}
            </td>
            {can('menu:write') ? (
              <td className="px-3 py-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                  {dict.common.edit}
                </Button>
              </td>
            ) : null}
          </tr>
        ))}
      </Table>

      {editing ? (
        <CategoryDialog
          category={editing === 'NEW' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['menu-categories'] });
          }}
        />
      ) : null}
    </div>
  );
}

function CategoryDialog({
  category,
  onClose,
  onDone,
}: {
  category: Category | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: category?.name ?? '',
    nameHi: category?.nameI18n?.['hi'] ?? '',
    nameTe: category?.nameI18n?.['te'] ?? '',
    mealSlot: category?.mealSlot ?? 'LUNCH',
    sortOrder: String(category?.sortOrder ?? 0),
    isActive: category?.isActive ?? true,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        nameI18n: Object.fromEntries(
          [
            ['hi', form.nameHi.trim()],
            ['te', form.nameTe.trim()],
          ].filter(([, v]) => v),
        ),
        mealSlot: form.mealSlot,
        sortOrder: Number(form.sortOrder) || 0,
        isActive: form.isActive,
      };
      return category ? put(`/menu/categories/${category.id}`, body) : post('/menu/categories', body);
    },
    onSuccess: onDone,
  });

  return (
    <FormDialog
      title={category ? `Edit ${category.name}` : 'Add a category'}
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={!form.name.trim()}
    >
      <TextField label="Name" value={form.name} onChange={(v) => set('name', v)} required autoFocus={!category} />
      <FormGrid>
        <TextField label="Hindi" value={form.nameHi} onChange={(v) => set('nameHi', v)} />
        <TextField label="Telugu" value={form.nameTe} onChange={(v) => set('nameTe', v)} />
        <SelectField
          label="Meal slot"
          value={form.mealSlot}
          onChange={(v) => set('mealSlot', v)}
          options={MEAL_SLOTS.map((s) => ({ value: s, label: s.replace('_', ' ').toLowerCase() }))}
          hint="When this appears"
        />
        <NumberField label="Sort order" value={form.sortOrder} onChange={(v) => set('sortOrder', v)} min={0} />
      </FormGrid>
      <CheckField
        label="Show on the menu"
        checked={form.isActive}
        onChange={(v) => set('isActive', v)}
        hint="Hiding a category hides its dishes from the public site and the POS."
      />
    </FormDialog>
  );
}

// ─── Recipes ─────────────────────────────────────────────────────────────────

/**
 * The recipe editor.
 *
 * This is the screen that turns food cost from a guess into a measurement: what goes into
 * one serving, in whatever unit the cook thinks in. Grams against an item stocked in
 * kilograms is fine and converts; litres against kilograms is refused, because inventing
 * a density would be worse than saying no.
 *
 * Saving creates a new version rather than editing in place, so the cost of thalis
 * already sold does not move.
 */
function Recipes() {
  const dict = useDict();
  const { branchId, can } = useSession();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<MarginRow | null>(null);

  const margins = useQuery({
    queryKey: ['margins', branchId],
    enabled: !!branchId,
    queryFn: () => get<MarginRow[]>(`/inventory/margins/${branchId}`),
  });

  const uncosted = (margins.data ?? []).filter((m) => !m.hasRecipe);

  return (
    <div className="space-y-3">
      {uncosted.length > 0 ? (
        <Card className="!border-amber-300 !bg-amber-50">
          <h2 className="font-medium text-amber-900">{uncosted.length} dishes have no recipe</h2>
          <p className="mt-1 text-sm text-amber-800">
            They sell fine, but they contribute nothing to food cost and consume no stock — so your
            variance report will show those ingredients disappearing unexplained. Cost the top sellers first.
          </p>
        </Card>
      ) : null}

      <ErrorNote error={margins.error} />

      <Table head={['Dish', 'Slot', 'Price', 'Recipe cost', dict.reports.foodCost, 'Target', ...(can('recipe:write') ? [dict.common.actions] : [])]}>
        {(margins.data ?? []).map((m) => (
          <tr key={`${m.menuItemId}-${m.mealSlot}`} className={m.overTarget ? 'bg-amber-50' : undefined}>
            <td className="px-3 py-2 font-medium">{m.name}</td>
            <td className="px-3 py-2 text-ink-600">{m.mealSlot.replace('_', ' ').toLowerCase()}</td>
            <td className="px-3 py-2 tabular-nums">{formatMinor(m.priceMinor)}</td>
            <td className="px-3 py-2 tabular-nums">{m.hasRecipe ? formatMinor(m.costMinor) : '—'}</td>
            <td className={`px-3 py-2 font-medium tabular-nums ${m.overTarget ? 'text-amber-700' : ''}`}>
              {m.hasRecipe ? formatBp(m.foodCostBp) : <Badge tone="neutral">no recipe</Badge>}
            </td>
            <td className="px-3 py-2 tabular-nums text-ink-400">{formatBp(m.targetBp, 0)}</td>
            {can('recipe:write') ? (
              <td className="px-3 py-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing(m)}>
                  {m.hasRecipe ? 'Edit recipe' : 'Add recipe'}
                </Button>
              </td>
            ) : null}
          </tr>
        ))}
      </Table>

      {editing ? (
        <RecipeDialog
          row={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['margins', branchId] });
            void queryClient.invalidateQueries({ queryKey: ['menu-items'] });
          }}
        />
      ) : null}
    </div>
  );
}

function RecipeDialog({ row, onClose, onDone }: { row: MarginRow; onClose: () => void; onDone: () => void }) {
  const existing = useQuery({
    queryKey: ['recipe', row.menuItemId],
    queryFn: () =>
      get<{
        yieldQty: string;
        lines: { inventoryItemId: string; qty: string; uomId: string; wastagePct: number }[];
      } | null>(`/inventory/recipes/${row.menuItemId}`),
  });

  const items = useQuery({ queryKey: ['inv-items'], queryFn: () => get<InventoryItem[]>('/inventory/items') });
  const uoms = useQuery({ queryKey: ['uoms'], queryFn: () => get<Uom[]>('/inventory/uoms') });

  const [lines, setLines] = useState<{ inventoryItemId: string; qty: string; uomId: string; wastagePct: string }[]>(
    [],
  );
  const [loaded, setLoaded] = useState(false);

  if (!loaded && existing.data !== undefined && items.data) {
    setLoaded(true);
    setLines(
      existing.data?.lines.map((l) => ({
        inventoryItemId: l.inventoryItemId,
        qty: String(l.qty),
        uomId: l.uomId,
        wastagePct: String(l.wastagePct),
      })) ?? [{ inventoryItemId: '', qty: '', uomId: '', wastagePct: '0' }],
    );
  }

  const mutation = useMutation({
    mutationFn: () =>
      post('/inventory/recipes', {
        menuItemId: row.menuItemId,
        variantId: null,
        yieldQty: '1',
        lines: lines
          .filter((l) => l.inventoryItemId && Number(l.qty) > 0 && l.uomId)
          .map((l) => ({
            inventoryItemId: l.inventoryItemId,
            qty: l.qty,
            uomId: l.uomId,
            wastagePct: Number(l.wastagePct) || 0,
            isOptional: false,
          })),
      }),
    onSuccess: onDone,
  });

  // Live cost as lines are typed, using the same weighted-average costs the server uses.
  const estimated = lines.reduce((sum, l) => {
    const item = items.data?.find((i) => i.id === l.inventoryItemId);
    const uom = uoms.data?.find((u) => u.id === l.uomId);
    if (!item || !uom || !l.qty) return sum;
    // Only same-unit or gram/kilogram style conversions are shown here; the server is
    // the authority and will refuse anything it cannot convert.
    const factor = uom.code === item.uom.code ? 1 : uom.code === 'g' && item.uom.code === 'kg' ? 0.001 : uom.code === 'ml' && item.uom.code === 'L' ? 0.001 : null;
    if (factor === null) return sum;
    return sum + Number(l.qty) * factor * (1 + (Number(l.wastagePct) || 0) / 100) * item.avgCostMinor;
  }, 0);

  const foodCostBp = row.priceMinor > 0 ? Math.round((estimated / row.priceMinor) * 10_000) : 0;

  return (
    <FormDialog
      title={`Recipe for ${row.name}`}
      subtitle="What goes into one serving. Saving creates a new version — dishes already sold keep their old cost."
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={!lines.some((l) => l.inventoryItemId && Number(l.qty) > 0 && l.uomId)}
      wide
    >
      <div className="space-y-2">
        <div className="hidden grid-cols-[1fr_5rem_6rem_5rem_2.5rem] gap-2 text-xs uppercase tracking-wide text-ink-400 sm:grid">
          <span>Ingredient</span>
          <span className="text-right">Qty</span>
          <span>Unit</span>
          <span className="text-right">Waste %</span>
          <span />
        </div>

        {lines.map((line, index) => {
          const item = items.data?.find((i) => i.id === line.inventoryItemId);
          return (
            <div key={index} className="grid grid-cols-[1fr_4.5rem_5.5rem_4.5rem_2.5rem] items-center gap-2">
              <select
                className="w-full rounded-lg border border-ink-200 bg-white px-2 py-2 text-sm"
                value={line.inventoryItemId}
                onChange={(e) => {
                  const picked = items.data?.find((i) => i.id === e.target.value);
                  setLines((ls) =>
                    ls.map((l, i) =>
                      i === index
                        ? { ...l, inventoryItemId: e.target.value, uomId: l.uomId || (picked?.uom.id ?? '') }
                        : l,
                    ),
                  );
                }}
              >
                <option value="">Choose…</option>
                {(items.data ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>

              <input
                className="w-full rounded-lg border border-ink-200 px-2 py-2 text-right text-sm tabular-nums"
                type="number"
                step="0.0001"
                value={line.qty}
                onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, qty: e.target.value } : l)))}
              />

              <select
                className="w-full rounded-lg border border-ink-200 bg-white px-1 py-2 text-sm"
                value={line.uomId}
                onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, uomId: e.target.value } : l)))}
              >
                <option value="">unit</option>
                {(uoms.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code}
                  </option>
                ))}
              </select>

              <input
                className="w-full rounded-lg border border-ink-200 px-2 py-2 text-right text-sm tabular-nums"
                type="number"
                min={0}
                max={100}
                value={line.wastagePct}
                onChange={(e) =>
                  setLines((ls) => ls.map((l, i) => (i === index ? { ...l, wastagePct: e.target.value } : l)))
                }
              />

              <Button
                type="button"
                variant="ghost"
                onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))}
                aria-label="Remove ingredient"
              >
                ✕
              </Button>

              {item ? (
                <div className="col-span-5 -mt-1 text-xs text-ink-400">
                  stocked in {item.uom.code} at {formatMinor(item.avgCostMinor)}/{item.uom.code}
                </div>
              ) : null}
            </div>
          );
        })}

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setLines((ls) => [...ls, { inventoryItemId: '', qty: '', uomId: '', wastagePct: '0' }])}
        >
          + Add an ingredient
        </Button>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2 text-sm">
        <span className="text-ink-600">
          Estimated cost per serving · sells for {formatMinor(row.priceMinor)}
        </span>
        <span className="text-right">
          <span className="block font-semibold tabular-nums">{formatMinor(Math.round(estimated))}</span>
          <span className={`text-xs ${foodCostBp > row.targetBp ? 'text-amber-700' : 'text-leaf-600'}`}>
            {formatBp(foodCostBp)} food cost
          </span>
        </span>
      </div>

      <p className="text-xs text-ink-400">
        Waste % covers peeling, trimming and cooking loss — 15% on potatoes, 25% on cauliflower is typical.
      </p>
    </FormDialog>
  );
}

// ─── bits ────────────────────────────────────────────────────────────────────

/**
 * The public site picks up menu changes on its own within two minutes. This makes it
 * immediate — which is what you want when the thali has just run out.
 */
function PublishButton() {
  const [state, setState] = useState<'IDLE' | 'BUSY' | 'DONE' | 'FAILED'>('IDLE');

  return (
    <Button
      variant="secondary"
      disabled={state === 'BUSY'}
      onClick={async () => {
        setState('BUSY');
        try {
          const res = await fetch('/api/revalidate', {
            method: 'POST',
            headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
          });
          setState(res.ok ? 'DONE' : 'FAILED');
        } catch {
          setState('FAILED');
        }
        setTimeout(() => setState('IDLE'), 4000);
      }}
      title="The site updates by itself within two minutes; this does it now."
    >
      {state === 'BUSY'
        ? 'Publishing…'
        : state === 'DONE'
          ? 'Site updated ✓'
          : state === 'FAILED'
            ? 'Could not publish'
            : 'Publish to website'}
    </Button>
  );
}

function SlotPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1">
      {MEAL_SLOTS.map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
            value === s ? 'bg-ink-800 text-white' : 'border border-ink-200 bg-white text-ink-600'
          }`}
        >
          {s.replace('_', ' ').toLowerCase()}
        </button>
      ))}
    </div>
  );
}

function FoodTypeBadge({ type }: { type: string }) {
  const tone = type === 'NON_VEG' ? 'bad' : type === 'EGG' ? 'warn' : 'good';
  return <Badge tone={tone as 'bad' | 'warn' | 'good'}>{type.replace('_', '-').toLowerCase()}</Badge>;
}

function endOfTradingDay(): Date {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  ist.setHours(23, 59, 0, 0);
  return new Date(ist.getTime() - ist.getTimezoneOffset() * 60_000 + now.getTimezoneOffset() * 60_000);
}
