"use strict";
/** Mirrors the Prisma enums. Kept hand-written so the web app needs no Prisma dependency. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEAL_SLOT_LABELS = exports.RENEWABLE_DOCUMENT_CATEGORIES = exports.LEGAL_DOCUMENT_CATEGORIES = exports.CREDENTIAL_TYPES = exports.ATTENDANCE_STATUSES = exports.ATTENDANCE_SOURCES = exports.EMPLOYMENT_TYPES = exports.EMPLOYEE_ROLE_TYPES = exports.VENDOR_INVOICE_STATUSES = exports.PO_STATUSES = exports.STOCK_MOVEMENT_REASONS = exports.BUYING_RHYTHMS = exports.INVENTORY_CATEGORIES = exports.KITCHEN_STATIONS = exports.TENDER_TYPES = exports.PAYMENT_STATUSES = exports.ORDER_STATUSES = exports.ORDER_CHANNELS = exports.FOOD_TYPES = exports.MEAL_SLOTS = void 0;
exports.slotForHour = slotForHour;
exports.MEAL_SLOTS = ['LUNCH', 'CHAI', 'EVENING', 'ALL_DAY'];
exports.FOOD_TYPES = ['VEG', 'NON_VEG', 'EGG', 'JAIN'];
exports.ORDER_CHANNELS = ['DINE_IN', 'TAKEAWAY', 'ONLINE_PICKUP', 'DELIVERY'];
exports.ORDER_STATUSES = [
    'DRAFT',
    'PLACED',
    'CONFIRMED',
    'PREPARING',
    'READY',
    'SERVED',
    'SETTLED',
    'CANCELLED',
];
exports.PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID', 'REFUNDED', 'FAILED'];
exports.TENDER_TYPES = [
    'CASH',
    'UPI_MANUAL',
    'UPI_GATEWAY',
    'CARD',
    'WALLET',
    'COMPLIMENTARY',
    'CREDIT',
];
exports.KITCHEN_STATIONS = ['MAIN', 'CHINESE', 'CHAI', 'TANDOOR'];
exports.INVENTORY_CATEGORIES = [
    'PERISHABLE',
    'STAPLE',
    'SPICE',
    'DAIRY',
    'PACKAGING',
    'GAS',
    'BEVERAGE',
    'CONSUMABLE',
    'OTHER',
];
exports.BUYING_RHYTHMS = ['DAILY', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'AS_NEEDED'];
exports.STOCK_MOVEMENT_REASONS = [
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
];
exports.PO_STATUSES = [
    'DRAFT',
    'PENDING_APPROVAL',
    'APPROVED',
    'SENT',
    'PARTIALLY_RECEIVED',
    'RECEIVED',
    'CANCELLED',
    'CLOSED',
];
exports.VENDOR_INVOICE_STATUSES = [
    'UNPAID',
    'PARTIALLY_PAID',
    'PAID',
    'DISPUTED',
    'CANCELLED',
];
exports.EMPLOYEE_ROLE_TYPES = [
    'PARTNER',
    'MANAGER',
    'HEAD_CHEF',
    'CHEF',
    'HELPER',
    'CLEANER',
    'CASHIER',
    'DELIVERY',
];
exports.EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'DAILY_WAGE', 'CONTRACT'];
exports.ATTENDANCE_SOURCES = [
    'MANUAL',
    'WEB',
    'QR',
    'PIN',
    'NFC',
    'RFID',
    'BIOMETRIC',
    'MOBILE_GEO',
    'IMPORT',
];
exports.ATTENDANCE_STATUSES = [
    'PRESENT',
    'ABSENT',
    'HALF_DAY',
    'WEEKLY_OFF',
    'HOLIDAY',
    'LEAVE',
    'NEEDS_REVIEW',
];
exports.CREDENTIAL_TYPES = [
    'PIN',
    'NFC_CARD',
    'RFID_FOB',
    'BIOMETRIC_TEMPLATE_REF',
    'MOBILE_DEVICE',
    'QR_TOKEN',
];
exports.LEGAL_DOCUMENT_CATEGORIES = [
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
];
/** Which categories are annual renewals whose lapse can shut the shop. */
exports.RENEWABLE_DOCUMENT_CATEGORIES = [
    'FSSAI_REGISTRATION',
    'TRADE_LICENSE',
    'SHOP_ESTABLISHMENT',
    'INSURANCE',
    'FIRE_NOC',
    'POLLUTION_NOC',
    'RENT_AGREEMENT',
];
exports.MEAL_SLOT_LABELS = {
    LUNCH: 'Lunch — Thali',
    CHAI: 'Chai & Snacks',
    EVENING: 'Evening — Chinese',
    ALL_DAY: 'All Day',
};
/**
 * Default slot for a given local hour. Used to preselect the POS slot so staff do
 * not have to think at 1 pm. Editable by the operator.
 */
function slotForHour(hour) {
    if (hour >= 11 && hour < 16)
        return 'LUNCH';
    if (hour >= 17 && hour < 23)
        return 'EVENING';
    return 'CHAI';
}
