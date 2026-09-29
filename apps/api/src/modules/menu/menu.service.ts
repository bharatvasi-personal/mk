import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { MealSlot } from '@mk/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import type {
  BranchMenuPriceInput,
  MenuCategoryInput,
  MenuItemWriteInput,
} from './menu.types';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

@Injectable()
export class MenuService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  // ─── Read ─────────────────────────────────────────────────────────────────

  /**
   * The menu as the POS and the public site need it: priced, per branch, per slot.
   *
   * Everything is resolved in one query pass rather than per item, because the POS
   * loads this on every shift start over a 4G tether and then works from cache.
   */
  async branchMenu(branchId: string, opts: { mealSlot?: MealSlot; includeUnavailable?: boolean } = {}) {
    return this.db.run(async (tx) => {
      const rows = await tx.branchMenuItem.findMany({
        where: {
          branchId,
          ...(opts.mealSlot ? { mealSlot: opts.mealSlot } : {}),
          ...(opts.includeUnavailable ? {} : { isAvailable: true }),
          menuItem: { isActive: true, category: { isActive: true } },
          variant: { isActive: true },
        },
        select: {
          id: true,
          mealSlot: true,
          priceMinor: true,
          compareAtPriceMinor: true,
          gstRateBp: true,
          isAvailable: true,
          soldOutUntil: true,
          dailyLimit: true,
          variant: { select: { id: true, name: true, nameI18n: true, isDefault: true, sortOrder: true } },
          menuItem: {
            select: {
              id: true,
              name: true,
              nameI18n: true,
              slug: true,
              description: true,
              descriptionI18n: true,
              foodType: true,
              isLessOil: true,
              isMithilaSpecial: true,
              isChefSpecial: true,
              spiceLevel: true,
              allergens: true,
              imageKey: true,
              sortOrder: true,
              category: {
                select: { id: true, name: true, nameI18n: true, slug: true, sortOrder: true, mealSlot: true },
              },
            },
          },
        },
        orderBy: [{ menuItem: { sortOrder: 'asc' } }, { variant: { sortOrder: 'asc' } }],
      });

      const now = new Date();
      // Group by item so the UI renders one card with several price options, rather
      // than one card per variant.
      const byItem = new Map<string, {
        item: (typeof rows)[number]['menuItem'];
        variants: {
          branchMenuItemId: string;
          variantId: string;
          name: string;
          nameI18n: unknown;
          mealSlot: string;
          priceMinor: number;
          compareAtPriceMinor: number | null;
          gstRateBp: number;
          isSoldOut: boolean;
          dailyLimit: number | null;
        }[];
      }>();

      for (const row of rows) {
        const entry = byItem.get(row.menuItem.id) ?? { item: row.menuItem, variants: [] };
        entry.variants.push({
          branchMenuItemId: row.id,
          variantId: row.variant.id,
          name: row.variant.name,
          nameI18n: row.variant.nameI18n,
          mealSlot: row.mealSlot,
          priceMinor: row.priceMinor,
          compareAtPriceMinor: row.compareAtPriceMinor,
          gstRateBp: row.gstRateBp,
          isSoldOut: !!row.soldOutUntil && row.soldOutUntil > now,
          dailyLimit: row.dailyLimit,
        });
        byItem.set(row.menuItem.id, entry);
      }

      const categories = new Map<string, { id: string; name: string; nameI18n: unknown; slug: string; sortOrder: number; mealSlot: string; items: unknown[] }>();
      for (const { item, variants } of byItem.values()) {
        const c = item.category;
        const bucket =
          categories.get(c.id) ?? { ...c, items: [] as unknown[] };
        bucket.items.push({ ...item, category: undefined, variants });
        categories.set(c.id, bucket);
      }

      return [...categories.values()].sort((a, b) => a.sortOrder - b.sortOrder);
    });
  }

  async listCategories() {
    return this.db.run((tx) =>
      tx.menuCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    );
  }

  async listItems(opts: { categoryId?: string; search?: string } = {}) {
    return this.db.run((tx) =>
      tx.menuItem.findMany({
        where: {
          ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
          ...(opts.search ? { name: { contains: opts.search, mode: 'insensitive' } } : {}),
        },
        include: {
          variants: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
          category: { select: { id: true, name: true } },
          _count: { select: { recipes: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    );
  }

  // ─── Write ────────────────────────────────────────────────────────────────

  async upsertCategory(input: MenuCategoryInput, id?: string) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const slug = input.slug ?? slugify(input.name);
      if (id) {
        const before = await tx.menuCategory.findUniqueOrThrow({ where: { id } });
        const after = await tx.menuCategory.update({ where: { id }, data: { ...input, slug } });
        await this.audit.log(tx, {
          action: 'UPDATE',
          entity: 'MenuCategory',
          entityId: id,
          ...diff(before as never, after as never),
        });
        return after;
      }
      const created = await tx.menuCategory.create({ data: { ...input, slug, tenantId } });
      await this.audit.log(tx, {
        action: 'CREATE',
        entity: 'MenuCategory',
        entityId: created.id,
        after: created,
      });
      return created;
    });
  }

  async upsertItem(input: MenuItemWriteInput, id?: string) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const { variants, ...item } = input;
      const slug = slugify(item.name);

      if (!variants.some((v) => v.isDefault)) {
        // Exactly one default keeps the POS's "tap once to add" path unambiguous.
        variants[0]!.isDefault = true;
      }

      if (id) {
        const before = await tx.menuItem.findUniqueOrThrow({ where: { id }, include: { variants: true } });
        const updated = await tx.menuItem.update({ where: { id }, data: { ...item, slug } });

        for (const v of variants) {
          if (v.id) {
            await tx.menuItemVariant.update({ where: { id: v.id }, data: { ...v, id: undefined } });
          } else {
            await tx.menuItemVariant.create({ data: { ...v, id: undefined, menuItemId: id, tenantId } });
          }
        }
        // Variants that disappeared are deactivated, not deleted — historical order
        // lines and recipes still point at them.
        const keptIds = variants.filter((v) => v.id).map((v) => v.id!);
        await tx.menuItemVariant.updateMany({
          where: { menuItemId: id, id: { notIn: keptIds.length ? keptIds : ['00000000-0000-0000-0000-000000000000'] } },
          data: { isActive: false },
        });

        await this.audit.log(tx, {
          action: 'UPDATE',
          entity: 'MenuItem',
          entityId: id,
          before,
          after: updated,
        });
        return tx.menuItem.findUniqueOrThrow({ where: { id }, include: { variants: true } });
      }

      const created = await tx.menuItem.create({
        data: {
          ...item,
          slug,
          tenantId,
          variants: { create: variants.map((v) => ({ ...v, id: undefined, tenantId })) },
        },
        include: { variants: true },
      });
      await this.audit.log(tx, { action: 'CREATE', entity: 'MenuItem', entityId: created.id, after: created });
      return created;
    });
  }

  /**
   * Price changes are audited individually. "Who put the thali up to ₹130 and when"
   * is a question that will absolutely be asked, probably by a partner.
   */
  async setBranchPrice(input: BranchMenuPriceInput) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const variant = await tx.menuItemVariant.findUnique({
        where: { id: input.variantId },
        select: { menuItemId: true },
      });
      if (!variant) throw new NotFoundException('Unknown menu variant');

      const before = await tx.branchMenuItem.findUnique({
        where: {
          branchId_variantId_mealSlot: {
            branchId: input.branchId,
            variantId: input.variantId,
            mealSlot: input.mealSlot,
          },
        },
      });

      const after = await tx.branchMenuItem.upsert({
        where: {
          branchId_variantId_mealSlot: {
            branchId: input.branchId,
            variantId: input.variantId,
            mealSlot: input.mealSlot,
          },
        },
        create: { ...input, tenantId, menuItemId: variant.menuItemId },
        update: {
          priceMinor: input.priceMinor,
          compareAtPriceMinor: input.compareAtPriceMinor ?? null,
          gstRateBp: input.gstRateBp,
          isAvailable: input.isAvailable,
          dailyLimit: input.dailyLimit ?? null,
        },
      });

      await this.audit.log(tx, {
        action: before ? 'PRICE_CHANGE' : 'PRICE_SET',
        entity: 'BranchMenuItem',
        entityId: after.id,
        branchId: input.branchId,
        before: before ? { priceMinor: before.priceMinor } : null,
        after: { priceMinor: after.priceMinor },
      });
      return after;
    });
  }

  /** "Thali khatam" — the single most-used button in the shop after 1:30 pm. */
  async setSoldOut(branchMenuItemId: string, soldOutUntil: Date | null) {
    return this.db.run(async (tx) => {
      const row = await tx.branchMenuItem.update({
        where: { id: branchMenuItemId },
        data: { soldOutUntil },
      });
      await this.audit.log(tx, {
        action: soldOutUntil ? 'SOLD_OUT' : 'SOLD_OUT_CLEARED',
        entity: 'BranchMenuItem',
        entityId: branchMenuItemId,
        branchId: row.branchId,
        after: { soldOutUntil },
      });
      return row;
    });
  }

  /**
   * Copies one branch's prices to another. The reason branch #2 is a day of data entry
   * instead of a migration.
   */
  async cloneBranchPricing(fromBranchId: string, toBranchId: string, markupBp = 0) {
    if (fromBranchId === toBranchId) throw new BadRequestException('Source and target are the same branch');
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const source = await tx.branchMenuItem.findMany({ where: { branchId: fromBranchId } });
      let created = 0;
      for (const row of source) {
        const priceMinor = Math.round(row.priceMinor * (1 + markupBp / 10_000));
        await tx.branchMenuItem.upsert({
          where: {
            branchId_variantId_mealSlot: {
              branchId: toBranchId,
              variantId: row.variantId,
              mealSlot: row.mealSlot,
            },
          },
          create: {
            tenantId,
            branchId: toBranchId,
            menuItemId: row.menuItemId,
            variantId: row.variantId,
            mealSlot: row.mealSlot,
            priceMinor,
            gstRateBp: row.gstRateBp,
          },
          update: { priceMinor },
        });
        created += 1;
      }
      await this.audit.log(tx, {
        action: 'CLONE_PRICING',
        entity: 'Branch',
        entityId: toBranchId,
        after: { fromBranchId, rows: created, markupBp },
      });
      return { copied: created };
    });
  }
}

/** The tenant id Postgres is currently scoped to — the one RLS will accept. */
export async function currentTenant(tx: { $queryRawUnsafe: (q: string) => Promise<unknown> }): Promise<string> {
  const rows = (await tx.$queryRawUnsafe(
    `SELECT current_setting('app.tenant_id', true) AS t`,
  )) as { t: string | null }[];
  const t = rows[0]?.t;
  if (!t) throw new Error('No tenant scope on this transaction');
  return t;
}
