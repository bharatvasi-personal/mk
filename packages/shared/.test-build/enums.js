"use strict";
/** Mirrors the Prisma enums. Kept hand-written so the web app needs no Prisma dependency. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEAL_SLOT_LABELS = exports.RENEWABLE_DOCUMENT_CATEGORIES = exports.LEGAL_DOCUMENT_GROUPS = exports.LEGAL_DOCUMENT_CATEGORIES = exports.CREDENTIAL_TYPES = exports.ATTENDANCE_STATUSES = exports.ATTENDANCE_SOURCES = exports.EMPLOYMENT_TYPES = exports.EMPLOYEE_ROLE_TYPES = exports.VENDOR_INVOICE_STATUSES = exports.PO_STATUSES = exports.STOCK_MOVEMENT_REASONS = exports.BUYING_RHYTHMS = exports.INVENTORY_CATEGORIES = exports.KITCHEN_STATIONS = exports.TENDER_TYPES = exports.PAYMENT_STATUSES = exports.ORDER_STATUSES = exports.ORDER_CHANNELS = exports.FOOD_TYPES = exports.MEAL_SLOTS = void 0;
exports.groupForDocumentCategory = groupForDocumentCategory;
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
/**
 * Documents grouped by what they actually belong to.
 *
 * A flat list of fifteen categories is a filing cabinet with no drawers. These groups are
 * how the people using it think about the paperwork: the licences that can close the shop
 * are not the same kind of thing as a staff contract, and neither is a rent agreement.
 *
 * The order matters — it is the order they appear on screen, most consequential first.
 */
exports.LEGAL_DOCUMENT_GROUPS = [
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
];
/** Which group a category belongs to. Anything unmapped falls into records. */
function groupForDocumentCategory(category) {
    const found = exports.LEGAL_DOCUMENT_GROUPS.find((g) => g.categories.includes(category));
    return found?.key ?? 'RECORDS';
}
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
/**
 * The business serves lunch and dinner. `EVENING` is the dinner service — the enum value
 * is kept because orders, prices and reports already reference it, and renaming a value
 * every historical row carries would buy nothing but a migration.
 */
exports.MEAL_SLOT_LABELS = {
    LUNCH: 'Lunch',
    CHAI: 'All day',
    EVENING: 'Dinner',
    ALL_DAY: 'All day',
};
/**
 * Default slot for a given local hour. Used to preselect the POS slot so staff do
 * not have to think at 1 pm. Editable by the operator.
 */
function slotForHour(hour) {
    // Lunch service runs to 3 pm and dinner from 7; the gap defaults to lunch because
    // that is when the day's remaining thalis are still being sold.
    if (hour >= 10 && hour < 18)
        return 'LUNCH';
    if (hour >= 18 && hour < 23)
        return 'EVENING';
    return 'ALL_DAY';
}
