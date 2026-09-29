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

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  LUNCH: 'Lunch — Thali',
  CHAI: 'Chai & Snacks',
  EVENING: 'Evening — Chinese',
  ALL_DAY: 'All Day',
};

/**
 * Default slot for a given local hour. Used to preselect the POS slot so staff do
 * not have to think at 1 pm. Editable by the operator.
 */
export function slotForHour(hour: number): MealSlot {
  if (hour >= 11 && hour < 16) return 'LUNCH';
  if (hour >= 17 && hour < 23) return 'EVENING';
  return 'CHAI';
}
