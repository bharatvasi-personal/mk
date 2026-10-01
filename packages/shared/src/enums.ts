/** Mirrors the Prisma enums. Kept hand-written so the web app needs no Prisma dependency. */

export const MEAL_SLOTS = ['LUNCH', 'CHAI', 'EVENING', 'ALL_DAY'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const FOOD_TYPES = ['VEG', 'NON_VEG', 'EGG', 'JAIN'] as const;
export type FoodType = (typeof FOOD_TYPES)[number];

export const ORDER_CHANNELS = ['DINE_IN', 'TAKEAWAY', 'ONLINE_PICKUP', 'DELIVERY'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const ORDER_STATUSES = [
  'DRAFT',
  'PLACED',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'SERVED',
  'SETTLED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID', 'REFUNDED', 'FAILED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const TENDER_TYPES = [
  'CASH',
  'UPI_MANUAL',
  'UPI_GATEWAY',
  'CARD',
  'WALLET',
  'COMPLIMENTARY',
  'CREDIT',
] as const;
export type TenderType = (typeof TENDER_TYPES)[number];

export const KITCHEN_STATIONS = ['MAIN', 'CHINESE', 'CHAI', 'TANDOOR'] as const;
export type KitchenStation = (typeof KITCHEN_STATIONS)[number];

export const INVENTORY_CATEGORIES = [
  'PERISHABLE',
  'STAPLE',
  'SPICE',
  'DAIRY',
  'PACKAGING',
  'GAS',
  'BEVERAGE',
  'CONSUMABLE',
  'OTHER',
] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

export const BUYING_RHYTHMS = ['DAILY', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'AS_NEEDED'] as const;
export type BuyingRhythm = (typeof BUYING_RHYTHMS)[number];

export const STOCK_MOVEMENT_REASONS = [
  'PURCHASE_RECEIPT',
  'SALE_CONSUMPTION',
  'WASTAGE',
  'SPOILAGE',
  'STAFF_MEAL',
  'COUNT_ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'OPENING_BALANCE',
  'PURCHASE_RETURN',
  'PRODUCTION_INPUT',
  'PRODUCTION_OUTPUT',
] as const;
export type StockMovementReason = (typeof STOCK_MOVEMENT_REASONS)[number];

export const PO_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SENT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
  'CLOSED',
] as const;
export type PurchaseOrderStatus = (typeof PO_STATUSES)[number];

export const VENDOR_INVOICE_STATUSES = [
  'UNPAID',
  'PARTIALLY_PAID',
  'PAID',
  'DISPUTED',
  'CANCELLED',
] as const;
export type VendorInvoiceStatus = (typeof VENDOR_INVOICE_STATUSES)[number];

export const EMPLOYEE_ROLE_TYPES = [
  'PARTNER',
  'MANAGER',
  'HEAD_CHEF',
  'CHEF',
  'HELPER',
  'CLEANER',
  'CASHIER',
  'DELIVERY',
] as const;
export type EmployeeRoleType = (typeof EMPLOYEE_ROLE_TYPES)[number];

export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'DAILY_WAGE', 'CONTRACT'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const ATTENDANCE_SOURCES = [
  'MANUAL',
  'WEB',
  'QR',
  'PIN',
  'NFC',
  'RFID',
  'BIOMETRIC',
  'MOBILE_GEO',
  'IMPORT',
] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

export const ATTENDANCE_STATUSES = [
  'PRESENT',
  'ABSENT',
  'HALF_DAY',
  'WEEKLY_OFF',
  'HOLIDAY',
  'LEAVE',
  'NEEDS_REVIEW',
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const CREDENTIAL_TYPES = [
  'PIN',
  'NFC_CARD',
  'RFID_FOB',
  'BIOMETRIC_TEMPLATE_REF',
  'MOBILE_DEVICE',
  'QR_TOKEN',
] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export const LEGAL_DOCUMENT_CATEGORIES = [
  'PARTNERSHIP_DEED',
  'FSSAI_REGISTRATION',
  'TRADE_LICENSE',
  'SHOP_ESTABLISHMENT',
  'GST_CERTIFICATE',
  'RENT_AGREEMENT',
  'STAFF_CONTRACT',
  'INSURANCE',
  'FIRE_NOC',
  'POLLUTION_NOC',
  'UTILITY_AGREEMENT',
  'BANK_DOCUMENT',
  'INVOICE',
  'PAN_TAN',
  'OTHER',
] as const;
export type LegalDocumentCategory = (typeof LEGAL_DOCUMENT_CATEGORIES)[number];

/**
 * Documents grouped by what they actually belong to.
 *
 * A flat list of fifteen categories is a filing cabinet with no drawers. These groups are
 * how the people using it think about the paperwork: the licences that can close the shop
 * are not the same kind of thing as a staff contract, and neither is a rent agreement.
 *
 * The order matters — it is the order they appear on screen, most consequential first.
 */
export const LEGAL_DOCUMENT_GROUPS = [
  {
    key: 'LICENCES',
    label: 'Licences & registrations',
    /** These are why the module exists: let one lapse and the shop closes. */
    blurb: 'Annual renewals. Letting one lapse can shut the shop.',
    categories: [
      'FSSAI_REGISTRATION',
      'TRADE_LICENSE',
      'SHOP_ESTABLISHMENT',
      'FIRE_NOC',
      'POLLUTION_NOC',
    ],
  },
  {
    key: 'BUSINESS',
    label: 'The business itself',
    blurb: 'Who the firm is. Mostly one-off, mostly irreplaceable.',
    categories: ['PARTNERSHIP_DEED', 'PAN_TAN', 'GST_CERTIFICATE', 'BANK_DOCUMENT'],
  },
  {
    key: 'PREMISES',
    label: 'Premises',
    blurb: 'The shop itself — rent, electricity, water, gas connection.',
    categories: ['RENT_AGREEMENT', 'UTILITY_AGREEMENT'],
  },
  {
    key: 'PEOPLE',
    label: 'Staff',
    blurb: 'Contracts and anything attached to a named employee.',
    categories: ['STAFF_CONTRACT'],
  },
  {
    key: 'PROTECTION',
    label: 'Insurance',
    blurb: 'Fire, public liability, stock.',
    categories: ['INSURANCE'],
  },
  {
    key: 'RECORDS',
    label: 'Invoices & other records',
    blurb: 'Anything worth keeping that does not belong above.',
    categories: ['INVOICE', 'OTHER'],
  },
] as const;

export type LegalDocumentGroupKey = (typeof LEGAL_DOCUMENT_GROUPS)[number]['key'];

/** Which group a category belongs to. Anything unmapped falls into records. */
export function groupForDocumentCategory(category: string): LegalDocumentGroupKey {
  const found = LEGAL_DOCUMENT_GROUPS.find((g) =>
    (g.categories as readonly string[]).includes(category),
  );
  return found?.key ?? 'RECORDS';
}

/** Which categories are annual renewals whose lapse can shut the shop. */
export const RENEWABLE_DOCUMENT_CATEGORIES: readonly LegalDocumentCategory[] = [
  'FSSAI_REGISTRATION',
  'TRADE_LICENSE',
  'SHOP_ESTABLISHMENT',
  'INSURANCE',
  'FIRE_NOC',
  'POLLUTION_NOC',
  'RENT_AGREEMENT',
];

/**
 * The business serves lunch and dinner. `EVENING` is the dinner service — the enum value
 * is kept because orders, prices and reports already reference it, and renaming a value
 * every historical row carries would buy nothing but a migration.
 */
export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  LUNCH: 'Lunch',
  CHAI: 'All day',
  EVENING: 'Dinner',
  ALL_DAY: 'All day',
};

/**
 * Default slot for a given local hour. Used to preselect the POS slot so staff do
 * not have to think at 1 pm. Editable by the operator.
 */
export function slotForHour(hour: number): MealSlot {
  // Lunch service runs to 3 pm and dinner from 7; the gap defaults to lunch because
  // that is when the day's remaining thalis are still being sold.
  if (hour >= 10 && hour < 18) return 'LUNCH';
  if (hour >= 18 && hour < 23) return 'EVENING';
  return 'ALL_DAY';
}

// ─── Subscriptions (weekly / monthly meal plans) ─────────────────────────────

export const SUBSCRIPTION_PLANS = ['WEEKLY', 'MONTHLY'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** What the subscriber eats. MIXED lets the kitchen alternate. */
export const DIET_TYPES = ['VEG', 'NON_VEG', 'MIXED'] as const;
export type DietType = (typeof DIET_TYPES)[number];

/** Which meals the plan covers. Distinct from MEAL_SLOTS — a plan is a standing choice. */
export const MEAL_SHIFTS = ['LUNCH', 'DINNER', 'BOTH'] as const;
export type MealShift = (typeof MEAL_SHIFTS)[number];

export const SUBSCRIPTION_PLAN_LABELS: Record<SubscriptionPlan, string> = {
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
};

export const MEAL_SHIFT_LABELS: Record<MealShift, string> = {
  LUNCH: 'Lunch',
  DINNER: 'Dinner',
  BOTH: 'Lunch & Dinner',
};

export const DIET_LABELS: Record<DietType, string> = {
  VEG: 'Veg',
  NON_VEG: 'Non-veg (chicken)',
  MIXED: 'Mixed',
};

/** How many meals a shift delivers per day — used to bill and to size the daily list. */
export function mealsPerDay(shift: MealShift): number {
  return shift === 'BOTH' ? 2 : 1;
}
