'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formatMinor } from '@mk/shared';
import { Badge, Button, Card, Empty, ErrorNote, Table } from '@/components/ui';
import {
  CheckField,
  FormDialog,
  FormGrid,
  MoneyField,
  NumberField,
  SelectField,
  TextField,
  Toolbar,
} from '@/components/admin/form';
import { StaffShell } from '@/components/staff-shell';
import { get, post, put } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Option {
  id: string;
  name: string;
  priceDeltaMinor: number;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

interface Group {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
  options: Option[];
  _count: { itemLinks: number };
}

interface MenuItemRow {
  id: string;
  name: string;
  category: { name: string };
}

export default function ModifiersPage() {
  return (
    <StaffShell requires="menu:read" title="Modifiers & add-ons">
      <Modifiers />
    </StaffShell>
  );
}

/**
 * Modifiers: the choices a dish carries — spice level, add-ons, "which noodles".
 *
 * A group is defined once and attached to as many dishes as want it, so "extra roti" and
 * "extra spicy" live in one place. This is what lets the counter take a customised order
 * — the Chinese plate that is "half, extra spicy, add egg" — instead of inventing a
 * separate menu item for every combination.
 */
function Modifiers() {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Group | 'NEW' | null>(null);

  const groups = useQuery({
    queryKey: ['modifier-groups'],
    queryFn: () => get<Group[]>('/menu/modifiers/groups?includeInactive=true'),
  });

  const rows = groups.data ?? [];

  return (
    <div className="space-y-4">
      <Toolbar>
        <p className="text-sm text-ink-600">
          Define a set of choices once, then attach it to any dish. Add-on prices are added to the dish price on
          the bill.
        </p>
        {can('menu:write') ? (
          <div className="ml-auto">
            <Button onClick={() => setEditing('NEW')}>New group</Button>
          </div>
        ) : null}
      </Toolbar>

      <ErrorNote error={groups.error} />

      {rows.length === 0 ? (
        <Empty>No modifier groups yet. Create one — &ldquo;Spice level&rdquo; or &ldquo;Add-ons&rdquo; are the usual first two.</Empty>
      ) : (
        <Table head={['Group', 'Rule', 'Options', 'On dishes', ...(can('menu:write') ? [''] : [])]}>
          {rows.map((g) => (
            <tr key={g.id} className={g.isActive ? undefined : 'opacity-50'}>
              <td className="px-3 py-2">
                <div className="font-medium">{g.name}</div>
                {g.isActive ? null : <Badge tone="neutral">retired</Badge>}
              </td>
              <td className="px-3 py-2 text-sm text-ink-600">{ruleLabel(g)}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {g.options
                    .filter((o) => o.isActive)
                    .map((o) => (
                      <Badge key={o.id} tone={o.priceDeltaMinor ? 'brand' : 'neutral'}>
                        {o.name}
                        {o.priceDeltaMinor ? ` +${formatMinor(o.priceDeltaMinor)}` : ''}
                      </Badge>
                    ))}
                </div>
              </td>
              <td className="px-3 py-2 tabular-nums">{g._count.itemLinks}</td>
              {can('menu:write') ? (
                <td className="px-3 py-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(g)}>
                    Edit
                  </Button>
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      )}

      {can('menu:write') ? <AttachPanel /> : null}

      {editing ? (
        <GroupDialog
          group={editing === 'NEW' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['modifier-groups'] });
          }}
        />
      ) : null}
    </div>
  );
}

function ruleLabel(g: { minSelect: number; maxSelect: number }): string {
  const max = g.maxSelect === 0 ? 'any number' : g.maxSelect === 1 ? 'one' : `up to ${g.maxSelect}`;
  if (g.minSelect >= 1 && g.maxSelect === 1) return 'Required · pick one';
  if (g.minSelect >= 1) return `Required · pick ${g.minSelect}–${g.maxSelect === 0 ? 'any' : g.maxSelect}`;
  return `Optional · pick ${max}`;
}

/** A dynamic list of option rows, edited in place. */
function GroupDialog({
  group,
  onClose,
  onDone,
}: {
  group: Group | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [minSelect, setMinSelect] = useState(String(group?.minSelect ?? 0));
  const [maxSelect, setMaxSelect] = useState(String(group?.maxSelect ?? 1));
  const [isActive, setIsActive] = useState(group?.isActive ?? true);
  const [options, setOptions] = useState<{ id?: string; name: string; priceDeltaMinor: number; isDefault: boolean }[]>(
    group?.options.filter((o) => o.isActive).map((o) => ({
      id: o.id,
      name: o.name,
      priceDeltaMinor: o.priceDeltaMinor,
      isDefault: o.isDefault,
    })) ?? [{ name: '', priceDeltaMinor: 0, isDefault: false }],
  );

  const setOpt = (i: number, patch: Partial<(typeof options)[number]>) =>
    setOptions((prev) => prev.map((o, n) => (n === i ? { ...o, ...patch } : o)));

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        minSelect: Number(minSelect),
        maxSelect: Number(maxSelect),
        isActive,
        options: options
          .filter((o) => o.name.trim())
          .map((o, i) => ({ ...(o.id ? { id: o.id } : {}), name: o.name.trim(), priceDeltaMinor: o.priceDeltaMinor, isDefault: o.isDefault, sortOrder: i })),
      };
      return group ? put(`/menu/modifiers/groups/${group.id}`, body) : post('/menu/modifiers/groups', body);
    },
    onSuccess: onDone,
  });

  const named = options.filter((o) => o.name.trim());
  const invalid =
    name.trim().length < 2 ||
    named.length === 0 ||
    (Number(maxSelect) !== 0 && Number(maxSelect) < Number(minSelect));

  return (
    <FormDialog
      title={group ? `Edit ${group.name}` : 'New modifier group'}
      subtitle="Pick-one for spice or bread; pick-any for add-ons"
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      error={mutation.error}
      submitDisabled={invalid}
      submitLabel="Save"
      wide
    >
      <FormGrid>
        <TextField label="Group name" value={name} onChange={setName} required autoFocus placeholder="Spice level" />
        <div />
        <NumberField
          label="Minimum to pick"
          value={minSelect}
          onChange={setMinSelect}
          min={0}
          max={20}
          hint="1 or more makes the group required"
        />
        <NumberField
          label="Maximum to pick"
          value={maxSelect}
          onChange={setMaxSelect}
          min={0}
          max={20}
          hint="1 = single choice · 0 = no limit"
        />
      </FormGrid>

      <div className="mt-2">
        <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-[0.15em] text-ink-400">Options</p>
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="h-10 flex-1 rounded-lg border border-ink-200 px-3 text-sm"
                placeholder="Extra roti"
                value={o.name}
                onChange={(e) => setOpt(i, { name: e.target.value })}
              />
              <div className="w-28">
                <MoneyField label="+" minor={o.priceDeltaMinor} onChange={(m) => setOpt(i, { priceDeltaMinor: m })} />
              </div>
              <label className="flex items-center gap-1 whitespace-nowrap text-xs text-ink-600">
                <input
                  type="checkbox"
                  checked={o.isDefault}
                  onChange={(e) => setOpt(i, { isDefault: e.target.checked })}
                />
                default
              </label>
              <button
                type="button"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-ink-200 text-lg text-ink-500 hover:bg-ink-50"
                onClick={() => setOptions((prev) => prev.filter((_, n) => n !== i))}
                aria-label="Remove option"
              >
                −
              </button>
            </div>
          ))}
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="mt-2"
          onClick={() => setOptions((prev) => [...prev, { name: '', priceDeltaMinor: 0, isDefault: false }])}
        >
          + Add an option
        </Button>
      </div>

      {group ? (
        <CheckField
          label="In use"
          checked={isActive}
          onChange={setIsActive}
          hint="Unticking hides the group from the menu editor. Past bills keep their own snapshot."
        />
      ) : null}
    </FormDialog>
  );
}

/**
 * Attach groups to a dish.
 *
 * Kept on this screen rather than buried in the dish editor so someone setting up
 * modifiers for the first time can do it all in one place: build the groups above, then
 * pick a dish and tick which ones it shows.
 */
function AttachPanel() {
  const queryClient = useQueryClient();
  const [menuItemId, setMenuItemId] = useState('');

  const items = useQuery({
    queryKey: ['menu-items-for-modifiers'],
    queryFn: () => get<MenuItemRow[]>('/menu/items'),
  });
  const groups = useQuery({
    queryKey: ['modifier-groups'],
    queryFn: () => get<Group[]>('/menu/modifiers/groups?includeInactive=true'),
  });
  const attached = useQuery({
    queryKey: ['item-modifiers', menuItemId],
    enabled: !!menuItemId,
    queryFn: () => get<{ modifierGroupId: string }[]>(`/menu/modifiers/item/${menuItemId}`),
  });

  const activeGroups = (groups.data ?? []).filter((g) => g.isActive);
  const attachedIds = new Set((attached.data ?? []).map((a) => a.modifierGroupId));

  const save = useMutation({
    mutationFn: (groupIds: string[]) => put('/menu/modifiers/item', { menuItemId, groupIds }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['item-modifiers', menuItemId] });
      void queryClient.invalidateQueries({ queryKey: ['modifier-groups'] });
    },
  });

  function toggle(groupId: string) {
    const next = new Set(attachedIds);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    save.mutate([...next]);
  }

  return (
    <Card>
      <h2 className="font-display font-semibold">Attach to a dish</h2>
      <p className="mt-0.5 text-sm text-ink-600">Pick a dish, then tick the groups it should show at the counter.</p>

      <div className="mt-3 max-w-md">
        <SelectField
          label="Dish"
          value={menuItemId}
          onChange={setMenuItemId}
          placeholder="Choose a dish…"
          options={(items.data ?? []).map((i) => ({ value: i.id, label: `${i.name} · ${i.category.name}` }))}
        />
      </div>

      {menuItemId ? (
        activeGroups.length === 0 ? (
          <p className="mt-3 text-sm text-ink-400">No active groups to attach. Create one above first.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {activeGroups.map((g) => {
              const on = attachedIds.has(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggle(g.id)}
                  disabled={save.isPending}
                  aria-pressed={on}
                  className={`pos-tap rounded-full border px-4 py-2 text-sm font-semibold ${
                    on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-700'
                  }`}
                >
                  {on ? '✓ ' : ''}
                  {g.name}
                </button>
              );
            })}
          </div>
        )
      ) : null}
      <ErrorNote error={save.error} />
    </Card>
  );
}
