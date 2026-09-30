import { BadRequestException, Injectable } from '@nestjs/common';
import type { MenuItemModifiersInput, ModifierGroupInput } from '@mk/shared';
import { AuditService } from '../../common/audit/audit.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { currentTenant } from './menu.service';

/**
 * Modifiers: the choices a dish carries — spice level, add-ons, "which noodles".
 *
 * A group is defined once and shared across dishes, so "extra spicy" exists in one place
 * and the Chinese counter and the thali both point at it. An option's price delta is
 * GST-inclusive paise added to the line's unit price, never negative — a discount is not
 * a modifier, it lives on the order.
 *
 * Nothing here is ever deleted while it might sit on a past bill: an option pulled from a
 * group is deactivated, and the order line keeps its own snapshot regardless.
 */
@Injectable()
export class ModifiersService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  listGroups(includeInactive = false) {
    return this.db.run((tx) =>
      tx.modifierGroup.findMany({
        where: includeInactive ? {} : { isActive: true },
        include: {
          options: { orderBy: { sortOrder: 'asc' } },
          _count: { select: { itemLinks: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    );
  }

  /**
   * Upsert a group and reconcile its options in one transaction.
   *
   * Options that arrive with an id are updated; a name with no id is upserted on
   * (groupId, name) — the same rule the dish editor uses for variants, so an option
   * taken off and put back does not collide with its own deactivated row. Options that
   * vanish from the payload are deactivated, keyed on what was actually written.
   */
  async upsertGroup(input: ModifierGroupInput, id?: string) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const { options, ...group } = input;

      // Exactly one default is convenient for a single-choice group; harmless otherwise.
      if (input.maxSelect === 1 && !options.some((o: (typeof options)[number]) => o.isDefault) && options.length) {
        options[0]!.isDefault = true;
      }

      const saved = id
        ? await tx.modifierGroup.update({ where: { id }, data: group })
        : await tx.modifierGroup.create({ data: { ...group, tenantId } });

      const keptIds: string[] = [];
      for (const o of options) {
        const row = o.id
          ? await tx.modifierOption.update({
              where: { id: o.id },
              data: { ...o, id: undefined, isActive: true },
            })
          : await tx.modifierOption.upsert({
              where: { groupId_name: { groupId: saved.id, name: o.name } },
              create: { ...o, id: undefined, groupId: saved.id, tenantId },
              update: { ...o, id: undefined, isActive: true },
            });
        keptIds.push(row.id);
      }
      await tx.modifierOption.updateMany({
        where: {
          groupId: saved.id,
          id: { notIn: keptIds.length ? keptIds : ['00000000-0000-0000-0000-000000000000'] },
        },
        data: { isActive: false },
      });

      await this.audit.log(tx, {
        action: id ? 'UPDATE' : 'CREATE',
        entity: 'ModifierGroup',
        entityId: saved.id,
        after: { name: saved.name, options: options.length },
      });

      return tx.modifierGroup.findUniqueOrThrow({
        where: { id: saved.id },
        include: { options: { orderBy: { sortOrder: 'asc' } } },
      });
    });
  }

  /** Attach a set of groups to a dish, in the order given. Replaces the existing set. */
  async setItemGroups(input: MenuItemModifiersInput) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);

      const groups = await tx.modifierGroup.findMany({
        where: { id: { in: input.groupIds } },
        select: { id: true },
      });
      if (groups.length !== new Set(input.groupIds).size) {
        throw new BadRequestException('One or more modifier groups do not exist');
      }

      await tx.menuItemModifierGroup.deleteMany({ where: { menuItemId: input.menuItemId } });
      await tx.menuItemModifierGroup.createMany({
        data: input.groupIds.map((modifierGroupId: string, i: number) => ({
          tenantId,
          menuItemId: input.menuItemId,
          modifierGroupId,
          sortOrder: i,
        })),
      });

      await this.audit.log(tx, {
        action: 'UPDATE',
        entity: 'MenuItem',
        entityId: input.menuItemId,
        after: { modifierGroupIds: input.groupIds },
      });

      return tx.menuItemModifierGroup.findMany({
        where: { menuItemId: input.menuItemId },
        include: {
          modifierGroup: {
            include: { options: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
          },
        },
        orderBy: { sortOrder: 'asc' },
      });
    });
  }

  /** The groups (with active options) attached to one dish, in display order. */
  itemGroups(menuItemId: string) {
    return this.db.run((tx) =>
      tx.menuItemModifierGroup.findMany({
        where: { menuItemId },
        include: {
          modifierGroup: {
            include: { options: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
          },
        },
        orderBy: { sortOrder: 'asc' },
      }),
    );
  }
}
