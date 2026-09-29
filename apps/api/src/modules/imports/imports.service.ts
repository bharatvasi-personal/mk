import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BUYING_RHYTHMS,
  EMPLOYEE_ROLE_TYPES,
  EMPLOYMENT_TYPES,
  FOOD_TYPES,
  INVENTORY_CATEGORIES,
  MEAL_SLOTS,
  csvBool,
  csvDate,
  csvEnum,
  csvMoneyMinor,
  csvNumber,
  parseCsv,
  toCsv,
  type CsvRow,
} from '@mk/shared';
import { AuditService } from '../../common/audit/audit.service';
import { TenantDb, type Tx } from '../../common/prisma/tenant-db.service';
import { currentTenant } from '../menu/menu.service';

const D = Prisma.Decimal;

export type ImportEntity = 'inventory' | 'menu' | 'vendors' | 'employees';

export interface ImportRowResult {
  /** 1-based line number in the file, counting the header — what the spreadsheet shows. */
  line: number;
  action: 'CREATE' | 'UPDATE' | 'SKIP';
  label: string;
  errors: string[];
  warnings: string[];
}

export interface ImportPreview {
  entity: ImportEntity;
  totalRows: number;
  createCount: number;
  updateCount: number;
  errorCount: number;
  unknownHeaders: string[];
  missingHeaders: string[];
  rows: ImportRowResult[];
}

interface EntitySpec {
  required: string[];
  optional: string[];
  /** Human description of each column, used by the template and the UI. */
  columns: { name: string; description: string; example: string }[];
  permission: string;
}

/**
 * Bulk import from CSV.
 *
 * This exists for one unglamorous reason: without it, someone types thirty-one inventory
 * items, seventeen menu items, six vendors and five staff records by hand in the week
 * before the shop opens, and mistypes some of them. A spreadsheet is the tool this
 * business already has and already knows.
 *
 * Every import is a two-step: preview, then commit. The preview validates every row and
 * reports every problem at once — an importer that stops at the first bad row makes
 * someone fix a fifty-row file fifty times. The commit runs in a single transaction, so
 * a file either lands completely or not at all; a half-imported menu is worse than none,
 * because nobody can tell which half.
 *
 * Matching is by natural key — SKU, vendor code, employee code, item+variant — so
 * re-importing a corrected file updates rather than duplicating. That is the behaviour
 * people expect from a spreadsheet, and it makes "fix it and send it again" safe.
 */
@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  static readonly SPECS: Record<ImportEntity, EntitySpec> = {
    inventory: {
      required: ['sku', 'name', 'category', 'uom'],
      optional: [
        'nameHi', 'buyingRhythm', 'reorderPoint', 'parLevel', 'openingQty',
        'costPerUnit', 'vendorCode', 'shelfLifeDays', 'storageLocation',
      ],
      permission: 'inventory:write',
      columns: [
        { name: 'sku', description: 'Unique code. Re-importing the same SKU updates it.', example: 'RICE-SONA' },
        { name: 'name', description: 'What staff call it', example: 'Sona Masoori Rice' },
        { name: 'nameHi', description: 'Hindi name (optional)', example: 'चावल' },
        { name: 'category', description: INVENTORY_CATEGORIES.join(' / '), example: 'STAPLE' },
        { name: 'uom', description: 'Stock unit: kg, g, L, ml, pcs, pkt, cyl, bundle', example: 'kg' },
        { name: 'buyingRhythm', description: BUYING_RHYTHMS.join(' / '), example: 'WEEKLY' },
        { name: 'reorderPoint', description: 'Order more below this', example: '15' },
        { name: 'parLevel', description: 'Top up to this', example: '50' },
        { name: 'openingQty', description: 'Stock on hand right now', example: '30' },
        { name: 'costPerUnit', description: 'Rupees per stock unit', example: '52' },
        { name: 'vendorCode', description: 'Preferred vendor, by code', example: 'KIRANA-SL' },
        { name: 'shelfLifeDays', description: 'For perishables', example: '14' },
      ],
    },
    menu: {
      required: ['category', 'item', 'variant', 'mealSlot', 'price'],
      optional: [
        'itemHi', 'itemTe', 'categoryHi', 'categoryTe', 'description', 'foodType',
        'isLessOil', 'isMithilaSpecial', 'isChefSpecial', 'gstRate', 'dailyLimit',
      ],
      permission: 'menu:write',
      columns: [
        { name: 'category', description: 'Grouping on the menu', example: 'Thali' },
        { name: 'item', description: 'Dish name', example: 'Veg Thali' },
        { name: 'itemHi', description: 'Hindi name (optional)', example: 'वेज थाली' },
        { name: 'itemTe', description: 'Telugu name (optional)', example: 'వెజ్ థాలీ' },
        { name: 'variant', description: 'Size or portion. Use "Regular" if there is only one.', example: 'Full' },
        { name: 'mealSlot', description: MEAL_SLOTS.join(' / '), example: 'LUNCH' },
        { name: 'price', description: 'Rupees, GST inclusive, for this branch', example: '130' },
        { name: 'foodType', description: FOOD_TYPES.join(' / '), example: 'VEG' },
        { name: 'description', description: 'Shown on the public menu', example: 'Rice, dal, two vegetables, roti' },
        { name: 'isLessOil', description: 'yes / no', example: 'yes' },
        { name: 'isMithilaSpecial', description: 'yes / no', example: 'no' },
        { name: 'dailyLimit', description: 'Stop selling after this many a day', example: '80' },
      ],
    },
    vendors: {
      required: ['code', 'name'],
      optional: [
        'contactName', 'phone', 'altPhone', 'email', 'category', 'creditDays',
        'gstin', 'upiId', 'addressLine1', 'city', 'pincode', 'notes',
      ],
      permission: 'vendor:write',
      columns: [
        { name: 'code', description: 'Unique short code', example: 'KIRANA-SL' },
        { name: 'name', description: 'Business name', example: 'Sri Lakshmi Kirana' },
        { name: 'phone', description: '10-digit mobile', example: '9000010002' },
        { name: 'category', description: 'What they supply', example: 'Groceries' },
        { name: 'creditDays', description: 'Days of credit they extend. 0 = cash on delivery.', example: '15' },
        { name: 'gstin', description: 'If registered', example: '36ABCDE1234F1Z5' },
        { name: 'upiId', description: 'For paying them', example: 'srilakshmi@upi' },
      ],
    },
    employees: {
      required: ['employeeCode', 'name', 'roleType', 'joinedOn'],
      optional: [
        'phone', 'altPhone', 'employmentType', 'salaryBasis', 'monthlyGross',
        'dailyRate', 'weeklyOffDay', 'emergencyContactName', 'emergencyContactPhone',
        'addressLine1', 'notes',
      ],
      permission: 'employee:write',
      columns: [
        { name: 'employeeCode', description: 'Unique code', example: 'E001' },
        { name: 'name', description: 'Full name', example: 'Ramesh Kumar' },
        { name: 'phone', description: '10-digit mobile', example: '9000000011' },
        { name: 'roleType', description: EMPLOYEE_ROLE_TYPES.join(' / '), example: 'HELPER' },
        { name: 'employmentType', description: EMPLOYMENT_TYPES.join(' / '), example: 'DAILY_WAGE' },
        { name: 'joinedOn', description: 'YYYY-MM-DD or DD/MM/YYYY', example: '2026-10-01' },
        { name: 'salaryBasis', description: 'MONTHLY or DAILY', example: 'DAILY' },
        { name: 'monthlyGross', description: 'Rupees per month, if MONTHLY', example: '25000' },
        { name: 'dailyRate', description: 'Rupees per day, if DAILY', example: '600' },
        { name: 'weeklyOffDay', description: '0 = Sunday … 6 = Saturday', example: '2' },
      ],
    },
  };

  /** A CSV template with the headers and one worked example row. */
  template(entity: ImportEntity): string {
    const spec = ImportsService.SPECS[entity];
    const headers = spec.columns.map((c) => c.name);
    return toCsv(headers, [
      spec.columns.map((c) => c.example),
      // A second, empty row so the file opens with somewhere obvious to start typing.
      headers.map(() => ''),
    ]);
  }

  describe() {
    return (Object.keys(ImportsService.SPECS) as ImportEntity[]).map((entity) => ({
      entity,
      permission: ImportsService.SPECS[entity].permission,
      required: ImportsService.SPECS[entity].required,
      columns: ImportsService.SPECS[entity].columns,
    }));
  }

  async preview(entity: ImportEntity, csv: string, branchId: string): Promise<ImportPreview> {
    return this.db.run((tx) => this.process(tx, entity, csv, branchId, false));
  }

  async commit(entity: ImportEntity, csv: string, branchId: string): Promise<ImportPreview> {
    const preview = await this.preview(entity, csv, branchId);

    if (preview.missingHeaders.length > 0) {
      throw new BadRequestException({
        message: 'The file is missing required columns',
        errors: preview.missingHeaders.map((h) => ({ field: h, message: `Column "${h}" is required` })),
      });
    }
    if (preview.errorCount > 0) {
      // All-or-nothing. A partially imported menu is worse than none, because nobody can
      // tell which half made it.
      throw new BadRequestException({
        message: `${preview.errorCount} row${preview.errorCount === 1 ? '' : 's'} could not be imported. Fix them and upload again — nothing has been changed.`,
        errors: preview.rows
          .filter((r) => r.errors.length > 0)
          .slice(0, 25)
          .map((r) => ({ field: `line ${r.line}`, message: r.errors.join('; ') })),
      });
    }

    const result = await this.db.run(async (tx) => {
      const applied = await this.process(tx, entity, csv, branchId, true);
      await this.audit.log(tx, {
        action: 'BULK_IMPORT',
        entity: entity.toUpperCase(),
        branchId,
        after: {
          created: applied.createCount,
          updated: applied.updateCount,
          rows: applied.totalRows,
        },
      });
      return applied;
    });

    this.logger.log(
      `Imported ${entity}: ${result.createCount} created, ${result.updateCount} updated`,
    );
    return result;
  }

  // ─── The driver ───────────────────────────────────────────────────────────

  private async process(
    tx: Tx,
    entity: ImportEntity,
    csv: string,
    branchId: string,
    apply: boolean,
  ): Promise<ImportPreview> {
    const spec = ImportsService.SPECS[entity];
    const parsed = parseCsv(csv, { required: spec.required, optional: spec.optional });

    const preview: ImportPreview = {
      entity,
      totalRows: parsed.rows.length,
      createCount: 0,
      updateCount: 0,
      errorCount: 0,
      unknownHeaders: parsed.unknownHeaders,
      missingHeaders: parsed.missingHeaders,
      rows: [],
    };

    if (parsed.missingHeaders.length > 0) return preview;
    if (parsed.rows.length === 0) return preview;
    if (parsed.rows.length > 2000) {
      throw new BadRequestException('That file has more than 2,000 rows. Split it and import in parts.');
    }

    const handler = {
      inventory: (row: CsvRow, line: number) => this.inventoryRow(tx, row, line, branchId, apply),
      menu: (row: CsvRow, line: number) => this.menuRow(tx, row, line, branchId, apply),
      vendors: (row: CsvRow, line: number) => this.vendorRow(tx, row, line, apply),
      employees: (row: CsvRow, line: number) => this.employeeRow(tx, row, line, branchId, apply),
    }[entity];

    for (const [index, row] of parsed.rows.entries()) {
      // +2: one for the header, one because spreadsheets count from 1.
      const result = await handler(row, index + 2);
      preview.rows.push(result);
      if (result.errors.length > 0) preview.errorCount += 1;
      else if (result.action === 'CREATE') preview.createCount += 1;
      else if (result.action === 'UPDATE') preview.updateCount += 1;
    }

    return preview;
  }

  // ─── Inventory ────────────────────────────────────────────────────────────

  private async inventoryRow(
    tx: Tx,
    row: CsvRow,
    line: number,
    branchId: string,
    apply: boolean,
  ): Promise<ImportRowResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const tenantId = await currentTenant(tx);

    const sku = row['sku']?.trim();
    const name = row['name']?.trim();
    if (!sku) errors.push('sku is required');
    if (!name) errors.push('name is required');

    const category = csvEnum(row['category'], INVENTORY_CATEGORIES);
    if (!category) errors.push(`category "${row['category']}" is not one of ${INVENTORY_CATEGORIES.join(', ')}`);

    const uom = row['uom']
      ? await tx.uom.findFirst({ where: { code: { equals: row['uom'].trim(), mode: 'insensitive' } } })
      : null;
    if (!uom) errors.push(`unit "${row['uom']}" is not defined — add it first, or use one of kg, g, L, ml, pcs`);

    const rhythm = row['buyingRhythm'] ? csvEnum(row['buyingRhythm'], BUYING_RHYTHMS) : 'WEEKLY';
    if (row['buyingRhythm'] && !rhythm) errors.push(`buyingRhythm "${row['buyingRhythm']}" is not valid`);

    let vendorId: string | undefined;
    if (row['vendorCode']?.trim()) {
      const vendor = await tx.vendor.findFirst({ where: { code: row['vendorCode'].trim() } });
      if (!vendor) warnings.push(`vendor "${row['vendorCode']}" not found — imported without a preferred vendor`);
      else vendorId = vendor.id;
    }

    const cost = csvMoneyMinor(row['costPerUnit']);
    if (row['costPerUnit'] && cost === null) errors.push(`costPerUnit "${row['costPerUnit']}" is not a number`);

    const existing = sku ? await tx.inventoryItem.findFirst({ where: { sku } }) : null;
    const action = errors.length > 0 ? 'SKIP' : existing ? 'UPDATE' : 'CREATE';
    const label = `${sku ?? '?'} — ${name ?? '?'}`;

    if (!apply || errors.length > 0) return { line, action, label, errors, warnings };

    const data = {
      sku: sku!,
      name: name!,
      nameI18n: row['nameHi'] ? { hi: row['nameHi'] } : {},
      category: category!,
      uomId: uom!.id,
      buyingRhythm: rhythm!,
      shelfLifeDays: csvNumber(row['shelfLifeDays']) ?? null,
      ...(cost !== null ? { avgCostMinor: cost, lastPurchaseCostMinor: cost } : {}),
    };

    const item = existing
      ? await tx.inventoryItem.update({ where: { id: existing.id }, data })
      : await tx.inventoryItem.create({ data: { ...data, tenantId } });

    await tx.branchInventoryItem.upsert({
      where: { branchId_inventoryItemId: { branchId, inventoryItemId: item.id } },
      create: {
        tenantId,
        branchId,
        inventoryItemId: item.id,
        reorderPointQty: new D(csvNumber(row['reorderPoint']) ?? 0),
        parLevelQty: new D(csvNumber(row['parLevel']) ?? 0),
        preferredVendorId: vendorId,
        storageLocation: row['storageLocation'] || null,
      },
      update: {
        reorderPointQty: new D(csvNumber(row['reorderPoint']) ?? 0),
        parLevelQty: new D(csvNumber(row['parLevel']) ?? 0),
        ...(vendorId ? { preferredVendorId: vendorId } : {}),
      },
    });

    // Opening stock is posted only once, on creation. Re-importing a corrected file must
    // not add the opening balance a second time — that would be a silent stock gain.
    const openingQty = csvNumber(row['openingQty']);
    if (openingQty && openingQty > 0 && !existing) {
      const unitCost = cost ?? 0;
      await tx.stockLedgerEntry.create({
        data: {
          tenantId,
          branchId,
          inventoryItemId: item.id,
          qtyDelta: new D(openingQty),
          unitCostMinor: unitCost,
          valueMinor: Math.round(openingQty * unitCost),
          reason: 'OPENING_BALANCE',
          balanceAfterQty: new D(openingQty),
          note: 'Bulk import',
        },
      });
      await tx.branchInventoryItem.update({
        where: { branchId_inventoryItemId: { branchId, inventoryItemId: item.id } },
        data: { onHandQty: new D(openingQty) },
      });
    } else if (openingQty && existing) {
      warnings.push('openingQty ignored — this item already exists, so stock was not changed');
    }

    return { line, action, label, errors, warnings };
  }

  // ─── Menu ─────────────────────────────────────────────────────────────────

  private async menuRow(
    tx: Tx,
    row: CsvRow,
    line: number,
    branchId: string,
    apply: boolean,
  ): Promise<ImportRowResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const tenantId = await currentTenant(tx);

    const categoryName = row['category']?.trim();
    const itemName = row['item']?.trim();
    const variantName = row['variant']?.trim() || 'Regular';
    if (!categoryName) errors.push('category is required');
    if (!itemName) errors.push('item is required');

    const mealSlot = csvEnum(row['mealSlot'], MEAL_SLOTS);
    if (!mealSlot) errors.push(`mealSlot "${row['mealSlot']}" is not one of ${MEAL_SLOTS.join(', ')}`);

    const priceMinor = csvMoneyMinor(row['price']);
    if (priceMinor === null) errors.push(`price "${row['price']}" is not a number`);

    const foodType = row['foodType'] ? csvEnum(row['foodType'], FOOD_TYPES) : 'VEG';
    if (row['foodType'] && !foodType) errors.push(`foodType "${row['foodType']}" is not valid`);

    const slug = slugify(itemName ?? '');
    const existingItem = slug ? await tx.menuItem.findFirst({ where: { slug } }) : null;
    const existingVariant = existingItem
      ? await tx.menuItemVariant.findFirst({ where: { menuItemId: existingItem.id, name: variantName } })
      : null;

    const action = errors.length > 0 ? 'SKIP' : existingVariant ? 'UPDATE' : 'CREATE';
    const label = `${itemName ?? '?'} · ${variantName}`;

    if (!apply || errors.length > 0) return { line, action, label, errors, warnings };

    const categorySlug = slugify(categoryName!);
    const category = await tx.menuCategory.upsert({
      where: { tenantId_slug: { tenantId, slug: categorySlug } },
      create: {
        tenantId,
        name: categoryName!,
        nameI18n: pruneI18n({ hi: row['categoryHi'], te: row['categoryTe'] }),
        slug: categorySlug,
        mealSlot: mealSlot!,
      },
      // Importing a row means you want it on the menu. Leaving a previously deactivated
      // category hidden would make the import look like it silently did nothing.
      update: { isActive: true },
    });

    const itemData = {
      categoryId: category.id,
      name: itemName!,
      nameI18n: pruneI18n({ hi: row['itemHi'], te: row['itemTe'] }),
      slug,
      description: row['description'] || null,
      foodType: foodType!,
      isLessOil: csvBool(row['isLessOil']),
      isMithilaSpecial: csvBool(row['isMithilaSpecial']),
      isChefSpecial: csvBool(row['isChefSpecial']),
      isActive: true,
    };

    const item = existingItem
      ? await tx.menuItem.update({ where: { id: existingItem.id }, data: itemData })
      : await tx.menuItem.create({ data: { ...itemData, tenantId } });

    const variant =
      existingVariant ??
      (await tx.menuItemVariant.create({
        data: {
          tenantId,
          menuItemId: item.id,
          name: variantName,
          // The first variant of an item becomes the default, so the POS always has one
          // unambiguous thing to add on a single tap.
          isDefault: !(await tx.menuItemVariant.findFirst({ where: { menuItemId: item.id } })),
        },
      }));

    await tx.branchMenuItem.upsert({
      where: {
        branchId_variantId_mealSlot: { branchId, variantId: variant.id, mealSlot: mealSlot! },
      },
      create: {
        tenantId,
        branchId,
        menuItemId: item.id,
        variantId: variant.id,
        mealSlot: mealSlot!,
        priceMinor: priceMinor!,
        gstRateBp: csvNumber(row['gstRate']) !== null ? Math.round(csvNumber(row['gstRate'])! * 100) : 500,
        dailyLimit: csvNumber(row['dailyLimit']) ?? null,
      },
      update: {
        priceMinor: priceMinor!,
        dailyLimit: csvNumber(row['dailyLimit']) ?? null,
        isAvailable: true,
      },
    });

    return { line, action, label, errors, warnings };
  }

  // ─── Vendors ──────────────────────────────────────────────────────────────

  private async vendorRow(tx: Tx, row: CsvRow, line: number, apply: boolean): Promise<ImportRowResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const tenantId = await currentTenant(tx);

    const code = row['code']?.trim();
    const name = row['name']?.trim();
    if (!code) errors.push('code is required');
    if (!name) errors.push('name is required');

    const phone = normalisePhone(row['phone']);
    if (row['phone'] && !phone) warnings.push(`phone "${row['phone']}" is not a 10-digit mobile — imported blank`);

    const creditDays = csvNumber(row['creditDays']) ?? 0;
    if (creditDays < 0 || creditDays > 180) errors.push('creditDays must be between 0 and 180');

    const existing = code ? await tx.vendor.findFirst({ where: { code } }) : null;
    const action = errors.length > 0 ? 'SKIP' : existing ? 'UPDATE' : 'CREATE';

    if (!apply || errors.length > 0) return { line, action, label: `${code ?? '?'} — ${name ?? '?'}`, errors, warnings };

    const data = {
      code: code!,
      name: name!,
      contactName: row['contactName'] || null,
      phone,
      altPhone: normalisePhone(row['altPhone']),
      email: row['email'] || null,
      category: row['category'] || null,
      creditDays,
      gstin: row['gstin'] || null,
      upiId: row['upiId'] || null,
      addressLine1: row['addressLine1'] || null,
      city: row['city'] || null,
      pincode: row['pincode'] || null,
      notes: row['notes'] || null,
    };

    if (existing) await tx.vendor.update({ where: { id: existing.id }, data });
    else await tx.vendor.create({ data: { ...data, tenantId } });

    return { line, action, label: `${code} — ${name}`, errors, warnings };
  }

  // ─── Employees ────────────────────────────────────────────────────────────

  private async employeeRow(
    tx: Tx,
    row: CsvRow,
    line: number,
    branchId: string,
    apply: boolean,
  ): Promise<ImportRowResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const tenantId = await currentTenant(tx);

    const employeeCode = row['employeeCode']?.trim();
    const name = row['name']?.trim();
    if (!employeeCode) errors.push('employeeCode is required');
    if (!name) errors.push('name is required');

    const roleType = csvEnum(row['roleType'], EMPLOYEE_ROLE_TYPES);
    if (!roleType) errors.push(`roleType "${row['roleType']}" is not one of ${EMPLOYEE_ROLE_TYPES.join(', ')}`);

    const employmentType = row['employmentType']
      ? csvEnum(row['employmentType'], EMPLOYMENT_TYPES)
      : 'FULL_TIME';
    if (row['employmentType'] && !employmentType) errors.push(`employmentType "${row['employmentType']}" is not valid`);

    const joinedOn = csvDate(row['joinedOn']);
    if (!joinedOn) errors.push(`joinedOn "${row['joinedOn']}" is not a date — use 2026-10-01 or 01/10/2026`);

    const basis = row['salaryBasis']?.trim().toUpperCase() || (employmentType === 'DAILY_WAGE' ? 'DAILY' : 'MONTHLY');
    const monthly = csvMoneyMinor(row['monthlyGross']);
    const daily = csvMoneyMinor(row['dailyRate']);
    if (basis === 'MONTHLY' && monthly === null && daily === null) {
      warnings.push('no salary given — the employee is imported but payroll will skip them until one is set');
    }
    if (basis === 'DAILY' && daily === null && monthly === null) {
      warnings.push('no daily rate given — payroll will skip them until one is set');
    }

    const weeklyOff = csvNumber(row['weeklyOffDay']);
    if (weeklyOff !== null && (weeklyOff < 0 || weeklyOff > 6)) {
      errors.push('weeklyOffDay must be 0 (Sunday) to 6 (Saturday)');
    }

    const existing = employeeCode ? await tx.employee.findFirst({ where: { employeeCode } }) : null;
    const action = errors.length > 0 ? 'SKIP' : existing ? 'UPDATE' : 'CREATE';
    const label = `${employeeCode ?? '?'} — ${name ?? '?'}`;

    if (!apply || errors.length > 0) return { line, action, label, errors, warnings };

    const data = {
      branchId,
      employeeCode: employeeCode!,
      name: name!,
      phone: normalisePhone(row['phone']),
      altPhone: normalisePhone(row['altPhone']),
      roleType: roleType!,
      employmentType: employmentType!,
      joinedOn: new Date(joinedOn!),
      weeklyOffDay: weeklyOff,
      emergencyContactName: row['emergencyContactName'] || null,
      emergencyContactPhone: normalisePhone(row['emergencyContactPhone']),
      addressLine1: row['addressLine1'] || null,
      notes: row['notes'] || null,
    };

    const employee = existing
      ? await tx.employee.update({ where: { id: existing.id }, data })
      : await tx.employee.create({ data: { ...data, tenantId } });

    // A salary structure is only created if there is not one already — importing must
    // never silently overwrite a pay rate someone agreed with a member of staff.
    const hasSalary = await tx.salaryStructure.findFirst({ where: { employeeId: employee.id } });
    if (!hasSalary && (monthly !== null || daily !== null)) {
      await tx.salaryStructure.create({
        data: {
          tenantId,
          employeeId: employee.id,
          effectiveFrom: new Date(joinedOn!),
          basis: basis === 'DAILY' ? 'DAILY' : 'MONTHLY',
          monthlyGrossMinor: basis === 'MONTHLY' ? monthly : null,
          dailyRateMinor: basis === 'DAILY' ? daily : null,
          payDayOfMonth: 10,
        },
      });
    } else if (hasSalary && (monthly !== null || daily !== null)) {
      warnings.push('salary not changed — this employee already has a pay rate on record');
    }

    return { line, action, label, errors, warnings };
  }
}

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

/** Drops empty translations so a blank column does not store `{"hi": ""}`. */
function pruneI18n(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => !!entry[1]?.trim()),
  );
}

function normalisePhone(value: string | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}
