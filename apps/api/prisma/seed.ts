/**
 * Seeds MithilaKitchen as tenant #1 with the Osman Nagar branch, a realistic menu at
 * realistic Hyderabad prices, real-shaped vendors, an inventory list with recipes for
 * the top dishes, staff, shifts and the legal-document checklist.
 *
 * Everything here is a starting point to be corrected with real numbers before 15 Oct —
 * the point is that the system is never empty, so the team can practise on it.
 *
 * Idempotent: safe to re-run.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Seeding connects with the privileged migration role, not the application role.
 *
 * The app role is subject to FORCEd row-level security, and the very first insert here
 * creates the tenant that the policies key on — a chicken-and-egg that is correct to
 * resolve by using the owner role rather than by weakening the policy.
 */
const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL,
});

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'owner@mithilakitchen.in';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe@12345';

/** Rupees to paise, so the seed data reads like a menu board. */
const R = (rupees: number): number => Math.round(rupees * 100);

async function main(): Promise<void> {
  console.log('Seeding MithilaKitchen…\n');

  // Seeding writes across tenants by definition, and runs as the migration role.
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'mithilakitchen' },
    create: {
      slug: 'mithilakitchen',
      name: 'MithilaKitchen',
      legalName: 'MithilaKitchen (Partnership Firm)',
      entityType: 'PARTNERSHIP_FIRM',
      timezone: 'Asia/Kolkata',
      fyStartMonth: 4,
      settings: {
        tagline: 'Proper home food. Less oil. Fresh vegetables.',
        upiId: 'mithilakitchen@upi',
      },
    },
    update: {},
  });
  console.log(`tenant  ${tenant.name} (${tenant.id})`);

  await prisma.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tenant.id}', false)`);

  const branch = await prisma.branch.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'OSN' } },
    create: {
      tenantId: tenant.id,
      code: 'OSN',
      name: 'Osman Nagar',
      addressLine1: 'Shop No. 1, Osman Nagar Road',
      addressLine2: 'Tellapur',
      city: 'Hyderabad',
      state: 'Telangana',
      pincode: '502300',
      lat: 17.4899,
      lng: 78.2861,
      phone: '9000000000',
      geofenceRadiusM: 100,
      openingDate: new Date('2026-10-15'),
      operatingHours: {
        LUNCH: { open: '11:30', close: '15:30' },
        CHAI: { open: '07:00', close: '22:00' },
        EVENING: { open: '17:30', close: '22:30' },
        weeklyOff: null,
      },
    },
    update: {},
  });
  console.log(`branch  ${branch.name} (${branch.code})`);

  // ─── Units ────────────────────────────────────────────────────────────────
  const uomDefs = [
    { code: 'kg', name: 'Kilogram' },
    { code: 'g', name: 'Gram', baseCode: 'kg', factorToBase: 0.001 },
    { code: 'L', name: 'Litre' },
    { code: 'ml', name: 'Millilitre', baseCode: 'L', factorToBase: 0.001 },
    { code: 'pcs', name: 'Pieces' },
    { code: 'pkt', name: 'Packet' },
    { code: 'cyl', name: 'Gas cylinder' },
    { code: 'bundle', name: 'Bundle' },
  ];
  const uoms: Record<string, string> = {};
  for (const u of uomDefs) {
    const row = await prisma.uom.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: u.code } },
      create: { tenantId: tenant.id, ...u },
      update: {},
    });
    uoms[u.code] = row.id;
  }

  // ─── Users ────────────────────────────────────────────────────────────────
  const owner = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: OWNER_EMAIL } },
    create: {
      tenantId: tenant.id,
      name: 'Founding Partner',
      email: OWNER_EMAIL,
      phone: '9000000001',
      passwordHash: await argon2.hash(OWNER_PASSWORD, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
    },
    update: {},
  });
  // A compound unique containing a NULL cannot be matched by `upsert`, so the
  // tenant-wide grant is created conditionally.
  if (!(await prisma.userBranchRole.findFirst({ where: { userId: owner.id, role: 'OWNER' } }))) {
    await prisma.userBranchRole.create({
      data: { tenantId: tenant.id, userId: owner.id, role: 'OWNER', branchId: null },
    });
  }

  const manager = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'manager@mithilakitchen.in' } },
    create: {
      tenantId: tenant.id,
      name: 'Branch Manager',
      email: 'manager@mithilakitchen.in',
      phone: '9000000002',
      locale: 'te',
      passwordHash: await argon2.hash('Manager@12345', { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
    },
    update: {},
  });
  if (!(await prisma.userBranchRole.findFirst({ where: { userId: manager.id, branchId: branch.id } }))) {
    await prisma.userBranchRole.create({
      data: { tenantId: tenant.id, userId: manager.id, role: 'MANAGER', branchId: branch.id },
    });
  }

  const helperUser = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'counter@mithilakitchen.in' } },
    create: {
      tenantId: tenant.id,
      name: 'Counter Staff',
      email: 'counter@mithilakitchen.in',
      phone: '9000000003',
      locale: 'hi',
      passwordHash: await argon2.hash('Counter@12345', { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
    },
    update: {},
  });
  if (!(await prisma.userBranchRole.findFirst({ where: { userId: helperUser.id, branchId: branch.id } }))) {
    await prisma.userBranchRole.create({
      data: { tenantId: tenant.id, userId: helperUser.id, role: 'HELPER', branchId: branch.id },
    });
  }
  console.log('users   owner / manager / counter');

  // ─── Menu ─────────────────────────────────────────────────────────────────
  // Prices are Tellapur-realistic for Oct 2026: a working-class thali at ₹90–130,
  // chai at ₹12, Chinese plates at ₹70–120. Correct these against your real costing.
  // The real menu, matching the public site. Descriptions follow a convention the
  // landing page relies on: prose first, then the itemised contents separated by " • ".
  // One field serves both the paragraph the menu page wants and the checklist the
  // landing page shows.
  const menu: {
    category: string;
    categoryTe: string;
    categoryHi: string;
    slot: 'LUNCH' | 'CHAI' | 'EVENING' | 'ALL_DAY';
    items: {
      name: string;
      hi?: string;
      te?: string;
      desc?: string;
      type?: 'VEG' | 'NON_VEG' | 'EGG';
      lessOil?: boolean;
      mithila?: boolean;
      variants: { name: string; price: number; was?: number }[];
    }[];
  }[] = [
    {
      category: 'Ghar ki Thali',
      categoryHi: 'घर की थाली',
      categoryTe: 'ఘర్ కి థాలీ',
      slot: 'LUNCH',
      items: [
        {
          name: 'Ghar Ki Thali (Veg) - Roti Thali',
          hi: 'घर की थाली (वेज) — रोटी थाली',
          te: 'ఘర్ కి థాలీ (వెజ్) — రోటీ థాలీ',
          desc:
            'Wholesome everyday noon meal with fresh seasonal green sabzi and slow-simmered yellow arhar dal with jeera-ghee tadka. ' +
            '4 Soft Hand-Rolled Rotis • Homestyle Yellow Dal Tadka • Seasonal Green Sabzi • Steamed Rice • Kachumber Salad & Achaar',
          lessOil: true,
          variants: [{ name: 'Regular', price: 99, was: 149 }],
        },
        {
          name: 'Ghar Ki Thali (Veg) - Paratha Thali',
          hi: 'घर की थाली (वेज) — पराठा थाली',
          te: 'ఘర్ కి థాలీ (వెజ్) — పరాఠా థాలీ',
          desc:
            'Crispy layered parathas paired with homestyle cooking and aromatic yellow dal tadka. ' +
            '3 Golden Layered Parathas • Homestyle Yellow Dal Tadka • Seasonal Green Sabzi • Steamed Rice • Kachumber Salad & Achaar',
          lessOil: true,
          variants: [{ name: 'Regular', price: 99, was: 149 }],
        },
        {
          name: 'Ghar Ki Thali (Non-Veg) - Roti Thali',
          hi: 'घर की थाली (नॉन-वेज) — रोटी थाली',
          te: 'ఘర్ కి థాలీ (నాన్-వెజ్) — రోటీ థాలీ',
          desc:
            'Authentic homestyle chicken curry cooked with freshly ground spices and onions in mustard oil. ' +
            'Homestyle Chicken Curry (3 Pcs) • 4 Soft Hand-Rolled Rotis • Yellow Dal Tadka • Steamed Rice • Sirka Onion Salad & Pickle',
          type: 'NON_VEG',
          variants: [{ name: 'Regular', price: 149, was: 199 }],
        },
        {
          name: 'Ghar Ki Thali (Non-Veg) - Paratha Thali',
          hi: 'घर की थाली (नॉन-वेज) — पराठा थाली',
          te: 'ఘర్ కి థాలీ (నాన్-వెజ్) — పరాఠా థాలీ',
          desc:
            'Juicy, flavour-packed homestyle chicken curry paired with crispy flaky tawa parathas. ' +
            'Homestyle Chicken Curry (3 Pcs) • 3 Golden Layered Parathas • Yellow Dal Tadka • Steamed Rice • Sirka Onion Salad & Pickle',
          type: 'NON_VEG',
          variants: [{ name: 'Regular', price: 149, was: 199 }],
        },
      ],
    },
    {
      category: 'Mithila Deluxe Royal',
      categoryHi: 'मिथिला डीलक्स रॉयल',
      categoryTe: 'మిథిలా డీలక్స్ రాయల్',
      slot: 'LUNCH',
      items: [
        {
          name: 'Mithila Deluxe Royal (Veg)',
          hi: 'मिथिला डीलक्स रॉयल (वेज)',
          te: 'మిథిలా డీలక్స్ రాయల్ (వెజ్)',
          desc:
            'A richer midday royal vegetarian feast with rich paneer butter masala and fragrant jeera basmati rice. ' +
            'Paneer Makhani / Shahi Gravy • Dry Seasonal Veggie • Panchmel Dal • Jeera Basmati Rice • 4 Rotis OR 3 Parathas • Dahi & Sweet Gulab Jamun',
          mithila: true,
          variants: [{ name: 'Regular', price: 149, was: 199 }],
        },
        {
          name: 'Mithila Deluxe Royal (Non-Veg)',
          hi: 'मिथिला डीलक्स रॉयल (नॉन-वेज)',
          te: 'మిథిలా డీలక్స్ రాయల్ (నాన్-వెజ్)',
          desc:
            'The ultimate royal feast with a generous portion of slow-cooked special Mithila chicken curry. ' +
            'Special Mithila Chicken Curry • Dry Seasonal Vegetable • Yellow Dal Tadka • Jeera Basmati Rice • 4 Rotis OR 3 Parathas • Fresh Raita & Sweet',
          type: 'NON_VEG',
          mithila: true,
          variants: [{ name: 'Regular', price: 199, was: 249 }],
        },
      ],
    },
  ];

  const variantIds: Record<string, string> = {};

  for (const [ci, cat] of menu.entries()) {
    const category = await prisma.menuCategory.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: slugify(cat.category) } },
      create: {
        tenantId: tenant.id,
        name: cat.category,
        nameI18n: { hi: cat.categoryHi, te: cat.categoryTe },
        slug: slugify(cat.category),
        mealSlot: cat.slot,
        sortOrder: ci,
      },
      update: {},
    });

    for (const [ii, item] of cat.items.entries()) {
      const menuItem = await prisma.menuItem.upsert({
        where: { tenantId_slug: { tenantId: tenant.id, slug: slugify(item.name) } },
        create: {
          tenantId: tenant.id,
          categoryId: category.id,
          name: item.name,
          nameI18n: { hi: item.hi ?? item.name, te: item.te ?? item.name },
          slug: slugify(item.name),
          description: item.desc,
          foodType: item.type ?? 'VEG',
          isLessOil: item.lessOil ?? false,
          isMithilaSpecial: item.mithila ?? false,
          targetFoodCostPct: 32,
          sortOrder: ii,
        },
        update: {},
      });

      for (const [vi, v] of item.variants.entries()) {
        const variant = await prisma.menuItemVariant.upsert({
          where: { menuItemId_name: { menuItemId: menuItem.id, name: v.name } },
          create: {
            tenantId: tenant.id,
            menuItemId: menuItem.id,
            name: v.name,
            isDefault: vi === 0,
            sortOrder: vi,
          },
          update: {},
        });
        variantIds[`${item.name}|${v.name}`] = variant.id;

        await prisma.branchMenuItem.upsert({
          where: {
            branchId_variantId_mealSlot: {
              branchId: branch.id,
              variantId: variant.id,
              mealSlot: cat.slot,
            },
          },
          create: {
            tenantId: tenant.id,
            branchId: branch.id,
            menuItemId: menuItem.id,
            variantId: variant.id,
            mealSlot: cat.slot,
            priceMinor: R(v.price),
            compareAtPriceMinor: v.was ? R(v.was) : null,
            gstRateBp: 500,
            // A 12x18 shop genuinely runs out. Cap the thali so the online store stops selling.
            dailyLimit: item.name.includes('Thali') ? 80 : null,
          },
          update: { priceMinor: R(v.price), compareAtPriceMinor: v.was ? R(v.was) : null },
        });

        // Lunch and dinner are the same menu at the same price, so each dish is priced
        // into both slots rather than duplicated.
        if (cat.slot === 'LUNCH') {
          await prisma.branchMenuItem.upsert({
            where: {
              branchId_variantId_mealSlot: {
                branchId: branch.id,
                variantId: variant.id,
                mealSlot: 'EVENING',
              },
            },
            create: {
              tenantId: tenant.id,
              branchId: branch.id,
              menuItemId: menuItem.id,
              variantId: variant.id,
              mealSlot: 'EVENING',
              priceMinor: R(v.price),
              compareAtPriceMinor: v.was ? R(v.was) : null,
              gstRateBp: 500,
              dailyLimit: 80,
            },
            update: { priceMinor: R(v.price), compareAtPriceMinor: v.was ? R(v.was) : null },
          });
        }
      }
    }
  }
  console.log(`menu    ${menu.reduce((s, c) => s + c.items.length, 0)} items across ${menu.length} categories`);

  // ─── Tables ───────────────────────────────────────────────────────────────
  for (const label of ['T1', 'T2', 'T3', 'T4']) {
    await prisma.diningTable.upsert({
      where: { branchId_label: { branchId: branch.id, label } },
      create: { tenantId: tenant.id, branchId: branch.id, label, seats: 4 },
      update: {},
    });
  }

  // ─── Vendors ──────────────────────────────────────────────────────────────
  const vendorDefs = [
    { code: 'VEG-MANDI', name: 'Tellapur Vegetable Mandi', category: 'Vegetables', creditDays: 0, phone: '9000010001' },
    { code: 'KIRANA-SL', name: 'Sri Lakshmi Kirana & General Stores', category: 'Groceries', creditDays: 15, phone: '9000010002' },
    { code: 'DAIRY-VJ', name: 'Vijaya Dairy Distributor', category: 'Dairy', creditDays: 7, phone: '9000010003' },
    { code: 'GAS-BH', name: 'Bharat Gas Commercial', category: 'LPG', creditDays: 0, phone: '9000010004' },
    { code: 'PACK-SR', name: 'Sri Ram Packaging', category: 'Packaging', creditDays: 10, phone: '9000010005' },
    { code: 'MEAT-AL', name: 'Al-Noor Chicken Centre', category: 'Meat', creditDays: 3, phone: '9000010006' },
  ];
  const vendors: Record<string, string> = {};
  for (const v of vendorDefs) {
    const row = await prisma.vendor.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: v.code } },
      create: { tenantId: tenant.id, ...v, city: 'Hyderabad', pincode: '502300' },
      update: {},
    });
    vendors[v.code] = row.id;
  }
  console.log(`vendors ${vendorDefs.length}`);

  // ─── Inventory ────────────────────────────────────────────────────────────
  // Buying rhythm is the field that makes the purchase worklist usable: the daily-fresh
  // list is a phone screen at the mandi, the monthly list is a PO to a distributor.
  const inv: {
    sku: string;
    name: string;
    hi?: string;
    category: 'PERISHABLE' | 'STAPLE' | 'SPICE' | 'DAIRY' | 'PACKAGING' | 'GAS' | 'BEVERAGE' | 'CONSUMABLE';
    uom: string;
    rhythm: 'DAILY' | 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'AS_NEEDED';
    cost: number;
    reorder: number;
    par: number;
    vendor: string;
    shelfLife?: number;
  }[] = [
    { sku: 'RICE-SONA', name: 'Sona Masoori Rice', hi: 'चावल', category: 'STAPLE', uom: 'kg', rhythm: 'WEEKLY', cost: 52, reorder: 15, par: 50, vendor: 'KIRANA-SL' },
    { sku: 'DAL-TOOR', name: 'Toor Dal', hi: 'अरहर दाल', category: 'STAPLE', uom: 'kg', rhythm: 'WEEKLY', cost: 145, reorder: 5, par: 20, vendor: 'KIRANA-SL' },
    { sku: 'ATTA', name: 'Wheat Atta', hi: 'आटा', category: 'STAPLE', uom: 'kg', rhythm: 'WEEKLY', cost: 42, reorder: 10, par: 40, vendor: 'KIRANA-SL' },
    { sku: 'SATTU', name: 'Sattu (roasted gram flour)', category: 'STAPLE', uom: 'kg', rhythm: 'FORTNIGHTLY', cost: 120, reorder: 2, par: 8, vendor: 'KIRANA-SL' },
    { sku: 'OIL-SUN', name: 'Sunflower Oil', hi: 'तेल', category: 'STAPLE', uom: 'L', rhythm: 'WEEKLY', cost: 135, reorder: 5, par: 20, vendor: 'KIRANA-SL' },
    { sku: 'ONION', name: 'Onion', hi: 'प्याज़', category: 'PERISHABLE', uom: 'kg', rhythm: 'DAILY', cost: 32, reorder: 5, par: 20, vendor: 'VEG-MANDI', shelfLife: 14 },
    { sku: 'TOMATO', name: 'Tomato', hi: 'टमाटर', category: 'PERISHABLE', uom: 'kg', rhythm: 'DAILY', cost: 28, reorder: 4, par: 15, vendor: 'VEG-MANDI', shelfLife: 5 },
    { sku: 'POTATO', name: 'Potato', hi: 'आलू', category: 'PERISHABLE', uom: 'kg', rhythm: 'DAILY', cost: 26, reorder: 8, par: 30, vendor: 'VEG-MANDI', shelfLife: 21 },
    { sku: 'BRINJAL', name: 'Brinjal', category: 'PERISHABLE', uom: 'kg', rhythm: 'DAILY', cost: 35, reorder: 2, par: 8, vendor: 'VEG-MANDI', shelfLife: 4 },
    { sku: 'SAAG', name: 'Seasonal Saag', category: 'PERISHABLE', uom: 'bundle', rhythm: 'DAILY', cost: 15, reorder: 5, par: 20, vendor: 'VEG-MANDI', shelfLife: 2 },
    { sku: 'CABBAGE', name: 'Cabbage', category: 'PERISHABLE', uom: 'kg', rhythm: 'DAILY', cost: 24, reorder: 2, par: 10, vendor: 'VEG-MANDI', shelfLife: 7 },
    { sku: 'CAULI', name: 'Cauliflower', category: 'PERISHABLE', uom: 'kg', rhythm: 'DAILY', cost: 38, reorder: 2, par: 8, vendor: 'VEG-MANDI', shelfLife: 5 },
    { sku: 'CORIANDER', name: 'Coriander', category: 'PERISHABLE', uom: 'bundle', rhythm: 'DAILY', cost: 10, reorder: 3, par: 12, vendor: 'VEG-MANDI', shelfLife: 3 },
    { sku: 'CHICKEN', name: 'Chicken (curry cut)', category: 'PERISHABLE', uom: 'kg', rhythm: 'DAILY', cost: 220, reorder: 2, par: 8, vendor: 'MEAT-AL', shelfLife: 2 },
    { sku: 'EGG', name: 'Eggs', category: 'PERISHABLE', uom: 'pcs', rhythm: 'DAILY', cost: 7, reorder: 30, par: 120, vendor: 'KIRANA-SL', shelfLife: 14 },
    { sku: 'MILK', name: 'Milk', hi: 'दूध', category: 'DAIRY', uom: 'L', rhythm: 'DAILY', cost: 62, reorder: 5, par: 25, vendor: 'DAIRY-VJ', shelfLife: 2 },
    { sku: 'CURD', name: 'Curd', hi: 'दही', category: 'DAIRY', uom: 'kg', rhythm: 'DAILY', cost: 70, reorder: 2, par: 10, vendor: 'DAIRY-VJ', shelfLife: 3 },
    { sku: 'PANEER', name: 'Paneer', category: 'DAIRY', uom: 'kg', rhythm: 'AS_NEEDED', cost: 340, reorder: 1, par: 4, vendor: 'DAIRY-VJ', shelfLife: 3 },
    { sku: 'TEA-DUST', name: 'Tea Dust', hi: 'चाय पत्ती', category: 'BEVERAGE', uom: 'kg', rhythm: 'MONTHLY', cost: 280, reorder: 1, par: 5, vendor: 'KIRANA-SL' },
    { sku: 'SUGAR', name: 'Sugar', hi: 'चीनी', category: 'STAPLE', uom: 'kg', rhythm: 'MONTHLY', cost: 46, reorder: 5, par: 25, vendor: 'KIRANA-SL' },
    { sku: 'SPICE-TUR', name: 'Turmeric Powder', category: 'SPICE', uom: 'kg', rhythm: 'MONTHLY', cost: 240, reorder: 0.5, par: 2, vendor: 'KIRANA-SL' },
    { sku: 'SPICE-CHI', name: 'Chilli Powder', category: 'SPICE', uom: 'kg', rhythm: 'MONTHLY', cost: 320, reorder: 0.5, par: 3, vendor: 'KIRANA-SL' },
    { sku: 'SPICE-GAR', name: 'Garam Masala', category: 'SPICE', uom: 'kg', rhythm: 'MONTHLY', cost: 520, reorder: 0.25, par: 1, vendor: 'KIRANA-SL' },
    { sku: 'SALT', name: 'Salt', category: 'SPICE', uom: 'kg', rhythm: 'MONTHLY', cost: 22, reorder: 2, par: 10, vendor: 'KIRANA-SL' },
    { sku: 'NOODLES', name: 'Hakka Noodles', category: 'STAPLE', uom: 'kg', rhythm: 'WEEKLY', cost: 90, reorder: 2, par: 10, vendor: 'KIRANA-SL' },
    { sku: 'SOYA-SAUCE', name: 'Soya Sauce', category: 'STAPLE', uom: 'L', rhythm: 'MONTHLY', cost: 130, reorder: 1, par: 4, vendor: 'KIRANA-SL' },
    { sku: 'PKG-BOX', name: 'Meal Box (750ml)', category: 'PACKAGING', uom: 'pcs', rhythm: 'AS_NEEDED', cost: 8, reorder: 100, par: 500, vendor: 'PACK-SR' },
    { sku: 'PKG-BAG', name: 'Carry Bag', category: 'PACKAGING', uom: 'pcs', rhythm: 'AS_NEEDED', cost: 2, reorder: 200, par: 1000, vendor: 'PACK-SR' },
    { sku: 'PKG-CUP', name: 'Paper Chai Cup', category: 'PACKAGING', uom: 'pcs', rhythm: 'WEEKLY', cost: 1.2, reorder: 200, par: 1500, vendor: 'PACK-SR' },
    { sku: 'GAS-19KG', name: 'LPG Commercial Cylinder 19kg', category: 'GAS', uom: 'cyl', rhythm: 'AS_NEEDED', cost: 1850, reorder: 1, par: 3, vendor: 'GAS-BH' },
    { sku: 'CLEAN-DISH', name: 'Dishwash Liquid', category: 'CONSUMABLE', uom: 'L', rhythm: 'MONTHLY', cost: 90, reorder: 1, par: 5, vendor: 'KIRANA-SL' },
  ];

  const invIds: Record<string, string> = {};
  for (const i of inv) {
    const item = await prisma.inventoryItem.upsert({
      where: { tenantId_sku: { tenantId: tenant.id, sku: i.sku } },
      create: {
        tenantId: tenant.id,
        sku: i.sku,
        name: i.name,
        nameI18n: i.hi ? { hi: i.hi } : {},
        category: i.category,
        uomId: uoms[i.uom]!,
        buyingRhythm: i.rhythm,
        avgCostMinor: R(i.cost),
        lastPurchaseCostMinor: R(i.cost),
        shelfLifeDays: i.shelfLife,
      },
      update: { avgCostMinor: R(i.cost) },
    });
    invIds[i.sku] = item.id;

    await prisma.branchInventoryItem.upsert({
      where: { branchId_inventoryItemId: { branchId: branch.id, inventoryItemId: item.id } },
      create: {
        tenantId: tenant.id,
        branchId: branch.id,
        inventoryItemId: item.id,
        reorderPointQty: i.reorder,
        parLevelQty: i.par,
        preferredVendorId: vendors[i.vendor],
      },
      update: { reorderPointQty: i.reorder, parLevelQty: i.par, preferredVendorId: vendors[i.vendor] },
    });

    await prisma.vendorItemPrice.createMany({
      data: [{ tenantId: tenant.id, vendorId: vendors[i.vendor]!, inventoryItemId: item.id, priceMinor: R(i.cost) }],
      skipDuplicates: true,
    });
  }
  console.log(`stock   ${inv.length} inventory items with reorder points and preferred vendors`);

  // ─── Recipes ──────────────────────────────────────────────────────────────
  // Quantities are per serving. These drive automatic stock depletion and the live
  // food-cost percentage — the single most valuable thing in the system once real.
  // Recipes for the real menu. Quantities are plausible starting points, NOT measured —
  // weigh a real thali during test cooking and correct them. Food cost is only worth
  // reading once these are yours.
  const recipes: { item: string; variant: string; lines: [string, number, string, number?][] }[] = [
    {
      item: 'Ghar Ki Thali (Veg) - Roti Thali',
      variant: 'Regular',
      lines: [
        ['ATTA', 0.12, 'kg'],
        ['RICE-SONA', 0.12, 'kg'],
        ['DAL-TOOR', 0.05, 'kg'],
        ['POTATO', 0.08, 'kg', 15],
        ['CAULI', 0.06, 'kg', 25],
        ['ONION', 0.05, 'kg', 10],
        ['TOMATO', 0.04, 'kg', 8],
        ['OIL-SUN', 0.015, 'L'],
        ['SPICE-TUR', 0.002, 'kg'],
        ['SPICE-CHI', 0.003, 'kg'],
        ['SALT', 0.004, 'kg'],
        ['PKG-BOX', 1, 'pcs'],
        ['PKG-BAG', 1, 'pcs'],
      ],
    },
    {
      item: 'Ghar Ki Thali (Veg) - Paratha Thali',
      variant: 'Regular',
      lines: [
        ['ATTA', 0.14, 'kg'],
        ['RICE-SONA', 0.12, 'kg'],
        ['DAL-TOOR', 0.05, 'kg'],
        ['POTATO', 0.08, 'kg', 15],
        ['CABBAGE', 0.06, 'kg', 15],
        ['ONION', 0.05, 'kg', 10],
        ['OIL-SUN', 0.03, 'L'],
        ['SPICE-TUR', 0.002, 'kg'],
        ['SALT', 0.004, 'kg'],
        ['PKG-BOX', 1, 'pcs'],
        ['PKG-BAG', 1, 'pcs'],
      ],
    },
    {
      item: 'Ghar Ki Thali (Non-Veg) - Roti Thali',
      variant: 'Regular',
      lines: [
        ['CHICKEN', 0.18, 'kg', 8],
        ['ATTA', 0.12, 'kg'],
        ['RICE-SONA', 0.12, 'kg'],
        ['DAL-TOOR', 0.04, 'kg'],
        ['ONION', 0.09, 'kg', 10],
        ['TOMATO', 0.06, 'kg', 8],
        ['OIL-SUN', 0.025, 'L'],
        ['SPICE-GAR', 0.003, 'kg'],
        ['SPICE-CHI', 0.004, 'kg'],
        ['SALT', 0.005, 'kg'],
        ['PKG-BOX', 1, 'pcs'],
        ['PKG-BAG', 1, 'pcs'],
      ],
    },
    {
      item: 'Ghar Ki Thali (Non-Veg) - Paratha Thali',
      variant: 'Regular',
      lines: [
        ['CHICKEN', 0.18, 'kg', 8],
        ['ATTA', 0.14, 'kg'],
        ['RICE-SONA', 0.12, 'kg'],
        ['DAL-TOOR', 0.04, 'kg'],
        ['ONION', 0.09, 'kg', 10],
        ['TOMATO', 0.06, 'kg', 8],
        ['OIL-SUN', 0.04, 'L'],
        ['SPICE-GAR', 0.003, 'kg'],
        ['SALT', 0.005, 'kg'],
        ['PKG-BOX', 1, 'pcs'],
        ['PKG-BAG', 1, 'pcs'],
      ],
    },
    {
      item: 'Mithila Deluxe Royal (Veg)',
      variant: 'Regular',
      lines: [
        ['PANEER', 0.09, 'kg'],
        ['ATTA', 0.12, 'kg'],
        ['RICE-SONA', 0.14, 'kg'],
        ['DAL-TOOR', 0.05, 'kg'],
        ['CURD', 0.08, 'kg'],
        ['MILK', 0.05, 'L'],
        ['ONION', 0.06, 'kg', 10],
        ['TOMATO', 0.06, 'kg', 8],
        ['CAULI', 0.05, 'kg', 25],
        ['OIL-SUN', 0.02, 'L'],
        ['SUGAR', 0.03, 'kg'],
        ['SPICE-GAR', 0.003, 'kg'],
        ['SALT', 0.005, 'kg'],
        ['PKG-BOX', 1, 'pcs'],
        ['PKG-BAG', 1, 'pcs'],
      ],
    },
    {
      item: 'Mithila Deluxe Royal (Non-Veg)',
      variant: 'Regular',
      lines: [
        ['CHICKEN', 0.25, 'kg', 8],
        ['ATTA', 0.12, 'kg'],
        ['RICE-SONA', 0.14, 'kg'],
        ['DAL-TOOR', 0.05, 'kg'],
        ['CURD', 0.08, 'kg'],
        ['ONION', 0.1, 'kg', 10],
        ['TOMATO', 0.07, 'kg', 8],
        ['CABBAGE', 0.05, 'kg', 15],
        ['OIL-SUN', 0.03, 'L'],
        ['SUGAR', 0.03, 'kg'],
        ['SPICE-GAR', 0.004, 'kg'],
        ['SALT', 0.005, 'kg'],
        ['PKG-BOX', 1, 'pcs'],
        ['PKG-BAG', 1, 'pcs'],
      ],
    },
  ];

  let recipeCount = 0;
  for (const r of recipes) {
    const variantId = variantIds[`${r.item}|${r.variant}`];
    if (!variantId) continue;
    const menuItem = await prisma.menuItemVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { menuItemId: true },
    });
    const existing = await prisma.recipe.findFirst({
      where: { menuItemId: menuItem.menuItemId, variantId, isActive: true },
    });
    if (existing) continue;

    await prisma.recipe.create({
      data: {
        tenantId: tenant.id,
        menuItemId: menuItem.menuItemId,
        variantId,
        yieldQty: 1,
        lines: {
          create: r.lines.map(([sku, qty, uom, wastage]) => ({
            tenantId: tenant.id,
            inventoryItemId: invIds[sku]!,
            qty,
            uomId: uoms[uom]!,
            wastagePct: wastage ?? 0,
          })),
        },
      },
    });
    recipeCount += 1;
  }
  console.log(`recipes ${recipeCount} costed dishes`);

  // ─── Opening stock ────────────────────────────────────────────────────────
  // So the POS is usable on day one and the variance report has a baseline.
  for (const i of inv) {
    const itemId = invIds[i.sku]!;
    const already = await prisma.stockLedgerEntry.findFirst({
      where: { branchId: branch.id, inventoryItemId: itemId, reason: 'OPENING_BALANCE' },
    });
    if (already) continue;
    const qty = i.par * 0.6;
    await prisma.stockLedgerEntry.create({
      data: {
        tenantId: tenant.id,
        branchId: branch.id,
        inventoryItemId: itemId,
        qtyDelta: qty,
        unitCostMinor: R(i.cost),
        valueMinor: Math.round(qty * R(i.cost)),
        reason: 'OPENING_BALANCE',
        balanceAfterQty: qty,
        note: 'Seeded opening stock',
      },
    });
    await prisma.branchInventoryItem.update({
      where: { branchId_inventoryItemId: { branchId: branch.id, inventoryItemId: itemId } },
      data: { onHandQty: qty },
    });
  }

  // ─── Shifts & staff ───────────────────────────────────────────────────────
  const shifts: Record<string, string> = {};
  for (const s of [
    { name: 'Morning', startTime: '07:00', endTime: '15:00', breakMinutes: 30, fullDayMinutes: 450 },
    { name: 'Evening', startTime: '15:00', endTime: '23:00', breakMinutes: 30, fullDayMinutes: 450 },
    { name: 'Full Day', startTime: '08:00', endTime: '22:00', breakMinutes: 90, fullDayMinutes: 750 },
  ]) {
    const row = await prisma.shift.upsert({
      where: { branchId_name: { branchId: branch.id, name: s.name } },
      create: { tenantId: tenant.id, branchId: branch.id, ...s, graceMinutes: 15 },
      update: {},
    });
    shifts[s.name] = row.id;
  }

  const staff = [
    { code: 'E001', name: 'Head Chef', roleType: 'HEAD_CHEF' as const, monthly: 25000, shift: 'Full Day', userId: undefined },
    { code: 'E002', name: 'Kitchen Helper 1', roleType: 'HELPER' as const, daily: 600, shift: 'Morning', userId: undefined },
    { code: 'E003', name: 'Kitchen Helper 2', roleType: 'HELPER' as const, daily: 600, shift: 'Evening', userId: undefined },
    { code: 'E004', name: 'Counter Staff', roleType: 'CASHIER' as const, monthly: 16000, shift: 'Full Day', userId: helperUser.id },
    { code: 'E005', name: 'Branch Manager', roleType: 'MANAGER' as const, monthly: 30000, shift: 'Full Day', userId: manager.id },
  ];

  for (const s of staff) {
    const employee = await prisma.employee.upsert({
      where: { tenantId_employeeCode: { tenantId: tenant.id, employeeCode: s.code } },
      create: {
        tenantId: tenant.id,
        branchId: branch.id,
        userId: s.userId,
        employeeCode: s.code,
        name: s.name,
        roleType: s.roleType,
        employmentType: s.daily ? 'DAILY_WAGE' : 'FULL_TIME',
        joinedOn: new Date('2026-10-01'),
        weeklyOffDay: s.roleType === 'HELPER' ? 2 : null,
      },
      update: {},
    });

    const hasSalary = await prisma.salaryStructure.findFirst({ where: { employeeId: employee.id } });
    if (!hasSalary) {
      await prisma.salaryStructure.create({
        data: {
          tenantId: tenant.id,
          employeeId: employee.id,
          effectiveFrom: new Date('2026-10-01'),
          basis: s.daily ? 'DAILY' : 'MONTHLY',
          monthlyGrossMinor: s.monthly ? R(s.monthly) : null,
          dailyRateMinor: s.daily ? R(s.daily) : null,
          components: s.monthly ? { basic: R(s.monthly * 0.6), hra: R(s.monthly * 0.25), allowance: R(s.monthly * 0.15) } : {},
          payDayOfMonth: 10,
        },
      });
    }

    const hasShift = await prisma.shiftAssignment.findFirst({ where: { employeeId: employee.id } });
    if (!hasShift) {
      await prisma.shiftAssignment.create({
        data: {
          tenantId: tenant.id,
          employeeId: employee.id,
          shiftId: shifts[s.shift]!,
          effectiveFrom: new Date('2026-10-01'),
        },
      });
    }
  }
  console.log(`staff   ${staff.length} employees with salary and shift`);

  // ─── Expense categories ───────────────────────────────────────────────────
  for (const c of [
    { name: 'Rent', isFixed: true },
    { name: 'Electricity', isFixed: false },
    { name: 'Water', isFixed: false },
    { name: 'Internet', isFixed: true },
    { name: 'Gas', isFixed: false },
    { name: 'Repairs & Maintenance', isFixed: false },
    { name: 'Licences & Fees', isFixed: true },
    { name: 'Marketing', isFixed: false },
    { name: 'Transport', isFixed: false },
  ]) {
    await prisma.expenseCategory.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: c.name } },
      create: { tenantId: tenant.id, ...c },
      update: {},
    });
  }

  console.log(`
Done.

  Owner     ${OWNER_EMAIL} / ${OWNER_PASSWORD}
  Manager   manager@mithilakitchen.in / Manager@12345
  Counter   counter@mithilakitchen.in / Counter@12345

  Change these before the shop opens. The legal-document vault starts empty on
  purpose — upload the partnership deed, FSSAI and trade licence with their real
  expiry dates so the renewal reminders have something to fire on.
`);
}

function slugify(v: string): string {
  return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
