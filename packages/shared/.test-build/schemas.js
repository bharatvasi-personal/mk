"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.kitchenTicketQuerySchema = exports.reportRangeSchema = exports.expenseSchema = exports.legalDocumentSchema = exports.salaryAdvanceSchema = exports.payrollRunSchema = exports.correctAttendanceSchema = exports.punchSchema = exports.shiftAssignmentSchema = exports.shiftSchema = exports.salaryStructureSchema = exports.employeeSchema = exports.vendorPaymentSchema = exports.goodsReceiptSchema = exports.purchaseOrderSchema = exports.vendorSchema = exports.stockCountSchema = exports.recipeSchema = exports.stockMovementSchema = exports.branchStockPolicySchema = exports.inventoryItemSchema = exports.paymentIntentSchema = exports.publicOrderSchema = exports.closeCashSessionSchema = exports.openCashSessionSchema = exports.updateOrderStatusSchema = exports.cancelOrderSchema = exports.voidOrderItemSchema = exports.settleOrderSchema = exports.tenderSchema = exports.createOrderSchema = exports.orderLineInputSchema = exports.setSoldOutSchema = exports.branchMenuPriceSchema = exports.menuItemSchema = exports.menuCategorySchema = exports.changePasswordSchema = exports.refreshSchema = exports.verifyOtpSchema = exports.requestOtpSchema = exports.staffLoginSchema = exports.paginationSchema = exports.dateOnly = exports.i18nText = exports.localeCode = exports.qty = exports.minor = exports.phone = exports.uuid = void 0;
/**
 * Wire contracts, as Zod objects.
 *
 * The API validates requests with these; the web app builds forms and typed
 * fetchers from the same objects; a future React Native app imports them
 * unchanged. One definition, three consumers, no drift.
 */
const zod_1 = require("zod");
const enums_1 = require("./enums");
exports.uuid = zod_1.z.string().uuid();
/** Indian mobile: 10 digits starting 6–9, with an optional +91. */
exports.phone = zod_1.z
    .string()
    .trim()
    .regex(/^(\+91)?[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number');
exports.minor = zod_1.z.number().int().nonnegative();
/** Quantities cross the wire as strings to survive Decimal without float loss. */
exports.qty = zod_1.z
    .union([zod_1.z.number(), zod_1.z.string()])
    .transform((v) => String(v))
    .refine((v) => /^-?\d+(\.\d{1,4})?$/.test(v), 'Up to 4 decimal places');
exports.localeCode = zod_1.z.enum(['en', 'hi', 'te']);
exports.i18nText = zod_1.z.record(zod_1.z.string()).default({});
exports.dateOnly = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
exports.paginationSchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).default(1),
    pageSize: zod_1.z.coerce.number().int().min(1).max(200).default(50),
});
// ─── Auth ────────────────────────────────────────────────────────────────────
exports.staffLoginSchema = zod_1.z.object({
    tenantSlug: zod_1.z.string().min(1),
    /** Email or phone — staff remember one or the other, not reliably both. */
    identifier: zod_1.z.string().min(3),
    password: zod_1.z.string().min(8),
    totpCode: zod_1.z.string().length(6).optional(),
    client: zod_1.z.enum(['WEB', 'POS', 'MOBILE']).default('WEB'),
});
exports.requestOtpSchema = zod_1.z.object({ tenantSlug: zod_1.z.string().min(1), phone: exports.phone });
exports.verifyOtpSchema = zod_1.z.object({
    tenantSlug: zod_1.z.string().min(1),
    phone: exports.phone,
    code: zod_1.z.string().length(6),
    name: zod_1.z.string().min(1).max(80).optional(),
});
exports.refreshSchema = zod_1.z.object({ refreshToken: zod_1.z.string().optional() });
exports.changePasswordSchema = zod_1.z.object({
    currentPassword: zod_1.z.string().min(8),
    newPassword: zod_1.z
        .string()
        .min(10, 'At least 10 characters')
        .regex(/[a-z]/, 'Needs a lowercase letter')
        .regex(/[A-Z]/, 'Needs an uppercase letter')
        .regex(/\d/, 'Needs a digit'),
});
// ─── Menu ────────────────────────────────────────────────────────────────────
exports.menuCategorySchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(80),
    nameI18n: exports.i18nText,
    slug: zod_1.z
        .string()
        .regex(/^[a-z0-9-]+$/)
        .optional(),
    mealSlot: zod_1.z.enum(enums_1.MEAL_SLOTS).default('ALL_DAY'),
    sortOrder: zod_1.z.number().int().default(0),
    isActive: zod_1.z.boolean().default(true),
});
exports.menuItemSchema = zod_1.z.object({
    categoryId: exports.uuid,
    name: zod_1.z.string().min(1).max(120),
    nameI18n: exports.i18nText,
    description: zod_1.z.string().max(600).optional(),
    descriptionI18n: exports.i18nText,
    foodType: zod_1.z.enum(enums_1.FOOD_TYPES).default('VEG'),
    isLessOil: zod_1.z.boolean().default(false),
    isMithilaSpecial: zod_1.z.boolean().default(false),
    isChefSpecial: zod_1.z.boolean().default(false),
    spiceLevel: zod_1.z.number().int().min(0).max(3).optional(),
    allergens: zod_1.z.array(zod_1.z.string()).default([]),
    targetFoodCostPct: zod_1.z.number().int().min(1).max(100).optional(),
    sortOrder: zod_1.z.number().int().default(0),
    isActive: zod_1.z.boolean().default(true),
    variants: zod_1.z
        .array(zod_1.z.object({
        id: exports.uuid.optional(),
        name: zod_1.z.string().min(1).max(40),
        nameI18n: exports.i18nText,
        isDefault: zod_1.z.boolean().default(false),
        sortOrder: zod_1.z.number().int().default(0),
    }))
        .min(1, 'At least one variant — use "Regular" if the item has no sizes'),
});
/** Price lives per branch × variant × meal slot. This is the row the POS reads. */
exports.branchMenuPriceSchema = zod_1.z.object({
    branchId: exports.uuid,
    variantId: exports.uuid,
    mealSlot: zod_1.z.enum(enums_1.MEAL_SLOTS),
    priceMinor: exports.minor,
    compareAtPriceMinor: exports.minor.optional(),
    gstRateBp: zod_1.z.number().int().min(0).max(2800).default(500),
    isAvailable: zod_1.z.boolean().default(true),
    dailyLimit: zod_1.z.number().int().positive().optional(),
});
exports.setSoldOutSchema = zod_1.z.object({
    branchMenuItemId: exports.uuid,
    /** null clears the flag; otherwise sold out until this instant (usually end of day). */
    soldOutUntil: zod_1.z.string().datetime().nullable(),
});
// ─── Orders / POS ────────────────────────────────────────────────────────────
exports.orderLineInputSchema = zod_1.z.object({
    variantId: exports.uuid,
    qty: zod_1.z.number().int().min(1).max(200),
    notes: zod_1.z.string().max(200).optional(),
});
exports.createOrderSchema = zod_1.z.object({
    branchId: exports.uuid,
    /** UUID minted by the POS before it has a network. Makes retries idempotent. */
    clientRef: exports.uuid,
    channel: zod_1.z.enum(enums_1.ORDER_CHANNELS),
    mealSlot: zod_1.z.enum(enums_1.MEAL_SLOTS),
    tableId: exports.uuid.optional(),
    customerName: zod_1.z.string().max(80).optional(),
    customerPhone: exports.phone.optional(),
    guestCount: zod_1.z.number().int().min(1).max(50).optional(),
    pickupAt: zod_1.z.string().datetime().optional(),
    notes: zod_1.z.string().max(400).optional(),
    items: zod_1.z.array(exports.orderLineInputSchema).min(1),
    /** POS-only. Discounts require `order:discount`. */
    discountMinor: exports.minor.default(0),
    discountReason: zod_1.z.string().max(120).optional(),
});
exports.tenderSchema = zod_1.z.object({
    tender: zod_1.z.enum(enums_1.TENDER_TYPES),
    amountMinor: zod_1.z.number().int().positive(),
    /** Cash only — used to compute change. */
    tenderedMinor: exports.minor.optional(),
    /** UPI UTR / card auth code. Required for UPI_MANUAL so the bank statement reconciles. */
    reference: zod_1.z.string().max(60).optional(),
});
exports.settleOrderSchema = zod_1.z
    .object({
    orderId: exports.uuid,
    tenders: zod_1.z.array(exports.tenderSchema).min(1),
    roundOff: zod_1.z.boolean().default(true),
    printBill: zod_1.z.boolean().default(true),
})
    .superRefine((v, ctx) => {
    for (const t of v.tenders) {
        if (t.tender === 'UPI_MANUAL' && !t.reference) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                path: ['tenders'],
                message: 'A UPI reference (UTR) is required so the bank statement can be reconciled',
            });
        }
    }
});
exports.voidOrderItemSchema = zod_1.z.object({
    orderId: exports.uuid,
    orderItemId: exports.uuid,
    reason: zod_1.z.string().min(3).max(200),
});
exports.cancelOrderSchema = zod_1.z.object({ orderId: exports.uuid, reason: zod_1.z.string().min(3).max(200) });
exports.updateOrderStatusSchema = zod_1.z.object({
    orderId: exports.uuid,
    status: zod_1.z.enum(['CONFIRMED', 'PREPARING', 'READY', 'SERVED']),
});
exports.openCashSessionSchema = zod_1.z.object({
    branchId: exports.uuid,
    openingFloatMinor: exports.minor,
});
exports.closeCashSessionSchema = zod_1.z.object({
    cashSessionId: exports.uuid,
    countedCashMinor: exports.minor,
    /** { "500": 4, "200": 3, "100": 11, ... } — a real cash-up, not a single number. */
    denominationCount: zod_1.z.record(zod_1.z.coerce.number().int().nonnegative()).optional(),
    notes: zod_1.z.string().max(400).optional(),
});
// ─── Online ordering (customer) ──────────────────────────────────────────────
exports.publicOrderSchema = zod_1.z.object({
    branchId: exports.uuid,
    clientRef: exports.uuid,
    mealSlot: zod_1.z.enum(enums_1.MEAL_SLOTS),
    items: zod_1.z.array(exports.orderLineInputSchema).min(1),
    pickupAt: zod_1.z.string().datetime(),
    notes: zod_1.z.string().max(300).optional(),
});
exports.paymentIntentSchema = zod_1.z.object({ orderId: exports.uuid });
// ─── Inventory ───────────────────────────────────────────────────────────────
exports.inventoryItemSchema = zod_1.z.object({
    sku: zod_1.z.string().min(1).max(40),
    name: zod_1.z.string().min(1).max(120),
    nameI18n: exports.i18nText,
    category: zod_1.z.enum(enums_1.INVENTORY_CATEGORIES),
    uomId: exports.uuid,
    buyingRhythm: zod_1.z.enum(enums_1.BUYING_RHYTHMS).default('WEEKLY'),
    shelfLifeDays: zod_1.z.number().int().positive().optional(),
    isTracked: zod_1.z.boolean().default(true),
    isActive: zod_1.z.boolean().default(true),
    notes: zod_1.z.string().max(400).optional(),
});
exports.branchStockPolicySchema = zod_1.z.object({
    branchId: exports.uuid,
    inventoryItemId: exports.uuid,
    reorderPointQty: exports.qty,
    parLevelQty: exports.qty,
    preferredVendorId: exports.uuid.optional(),
    storageLocation: zod_1.z.string().max(60).optional(),
});
/** Manual movement: wastage, staff meal, opening balance. Purchases go through a GRN. */
exports.stockMovementSchema = zod_1.z.object({
    branchId: exports.uuid,
    inventoryItemId: exports.uuid,
    qtyDelta: exports.qty,
    reason: zod_1.z.enum(enums_1.STOCK_MOVEMENT_REASONS),
    note: zod_1.z.string().max(300).optional(),
    occurredAt: zod_1.z.string().datetime().optional(),
});
exports.recipeSchema = zod_1.z.object({
    menuItemId: exports.uuid,
    variantId: exports.uuid.nullable().default(null),
    yieldQty: exports.qty.default('1'),
    notes: zod_1.z.string().max(400).optional(),
    lines: zod_1.z
        .array(zod_1.z.object({
        inventoryItemId: exports.uuid,
        qty: exports.qty,
        uomId: exports.uuid,
        wastagePct: zod_1.z.number().int().min(0).max(100).default(0),
        isOptional: zod_1.z.boolean().default(false),
    }))
        .min(1),
});
exports.stockCountSchema = zod_1.z.object({
    branchId: exports.uuid,
    countedOn: exports.dateOnly,
    scope: zod_1.z.string().max(40).optional(),
    notes: zod_1.z.string().max(400).optional(),
    lines: zod_1.z
        .array(zod_1.z.object({ inventoryItemId: exports.uuid, countedQty: exports.qty, reason: zod_1.z.string().max(200).optional() }))
        .min(1),
});
// ─── Vendors & purchasing ────────────────────────────────────────────────────
exports.vendorSchema = zod_1.z.object({
    code: zod_1.z.string().min(1).max(30),
    name: zod_1.z.string().min(1).max(140),
    contactName: zod_1.z.string().max(80).optional(),
    phone: exports.phone.optional(),
    altPhone: exports.phone.optional(),
    email: zod_1.z.string().email().optional(),
    addressLine1: zod_1.z.string().max(200).optional(),
    city: zod_1.z.string().max(60).optional(),
    pincode: zod_1.z.string().regex(/^\d{6}$/).optional(),
    gstin: zod_1.z
        .string()
        .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]Z[A-Z\d]$/, 'Not a valid GSTIN')
        .optional(),
    category: zod_1.z.string().max(60).optional(),
    creditDays: zod_1.z.number().int().min(0).max(180).default(0),
    creditLimitMinor: exports.minor.optional(),
    upiId: zod_1.z.string().max(80).optional(),
    notes: zod_1.z.string().max(400).optional(),
    isActive: zod_1.z.boolean().default(true),
});
exports.purchaseOrderSchema = zod_1.z.object({
    branchId: exports.uuid,
    vendorId: exports.uuid,
    expectedOn: exports.dateOnly.optional(),
    notes: zod_1.z.string().max(400).optional(),
    lines: zod_1.z
        .array(zod_1.z.object({
        inventoryItemId: exports.uuid,
        orderedQty: exports.qty,
        unitPriceMinor: exports.minor,
        gstRateBp: zod_1.z.number().int().min(0).max(2800).default(0),
    }))
        .min(1),
});
exports.goodsReceiptSchema = zod_1.z.object({
    branchId: exports.uuid,
    purchaseOrderId: exports.uuid.optional(),
    vendorId: exports.uuid,
    receivedOn: exports.dateOnly.optional(),
    /** The vendor's paper bill. Optional at receipt time; often arrives later. */
    billNo: zod_1.z.string().max(60).optional(),
    billDate: exports.dateOnly.optional(),
    billPhotoKey: zod_1.z.string().max(300).optional(),
    notes: zod_1.z.string().max(400).optional(),
    lines: zod_1.z
        .array(zod_1.z.object({
        inventoryItemId: exports.uuid,
        purchaseOrderLineId: exports.uuid.optional(),
        receivedQty: exports.qty,
        rejectedQty: exports.qty.default('0'),
        unitPriceMinor: exports.minor,
        batchNo: zod_1.z.string().max(60).optional(),
        expiryOn: exports.dateOnly.optional(),
    }))
        .min(1),
});
exports.vendorPaymentSchema = zod_1.z.object({
    vendorId: exports.uuid,
    amountMinor: zod_1.z.number().int().positive(),
    method: zod_1.z.enum(['CASH', 'UPI', 'NEFT', 'IMPS', 'CHEQUE']),
    reference: zod_1.z.string().max(80).optional(),
    paidOn: exports.dateOnly.optional(),
    notes: zod_1.z.string().max(300).optional(),
    /** Which bills this settles. Left empty, it is applied oldest-first. */
    allocations: zod_1.z.array(zod_1.z.object({ vendorInvoiceId: exports.uuid, amountMinor: zod_1.z.number().int().positive() })).default([]),
});
// ─── Employees, attendance, payroll ─────────────────────────────────────────
exports.employeeSchema = zod_1.z.object({
    branchId: exports.uuid,
    employeeCode: zod_1.z.string().min(1).max(30),
    name: zod_1.z.string().min(1).max(120),
    phone: exports.phone.optional(),
    altPhone: exports.phone.optional(),
    addressLine1: zod_1.z.string().max(200).optional(),
    emergencyContactName: zod_1.z.string().max(80).optional(),
    emergencyContactPhone: exports.phone.optional(),
    dateOfBirth: exports.dateOnly.optional(),
    roleType: zod_1.z.enum(enums_1.EMPLOYEE_ROLE_TYPES),
    employmentType: zod_1.z.enum(enums_1.EMPLOYMENT_TYPES).default('FULL_TIME'),
    joinedOn: exports.dateOnly,
    idProofType: zod_1.z.enum(['VOTER_ID', 'DRIVING_LICENSE', 'PASSPORT', 'RATION_CARD', 'OTHER']).optional(),
    /** Last four digits only. Aadhaar is deliberately not accepted. */
    idProofLast4: zod_1.z.string().regex(/^\d{4}$/).optional(),
    weeklyOffDay: zod_1.z.number().int().min(0).max(6).optional(),
    notes: zod_1.z.string().max(400).optional(),
    isActive: zod_1.z.boolean().default(true),
});
exports.salaryStructureSchema = zod_1.z
    .object({
    employeeId: exports.uuid,
    effectiveFrom: exports.dateOnly,
    basis: zod_1.z.enum(['MONTHLY', 'DAILY']),
    monthlyGrossMinor: exports.minor.optional(),
    dailyRateMinor: exports.minor.optional(),
    components: zod_1.z.record(exports.minor).default({}),
    overtimeRateMultiplier: zod_1.z.number().min(1).max(3).default(2),
    payDayOfMonth: zod_1.z.number().int().min(1).max(28).default(10),
})
    .refine((v) => (v.basis === 'MONTHLY' ? !!v.monthlyGrossMinor : !!v.dailyRateMinor), {
    message: 'Monthly basis needs a monthly gross; daily basis needs a daily rate',
});
exports.shiftSchema = zod_1.z.object({
    branchId: exports.uuid,
    name: zod_1.z.string().min(1).max(40),
    startTime: zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    endTime: zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    breakMinutes: zod_1.z.number().int().min(0).max(240).default(0),
    graceMinutes: zod_1.z.number().int().min(0).max(60).default(10),
    fullDayMinutes: zod_1.z.number().int().min(60).max(960).default(480),
    isActive: zod_1.z.boolean().default(true),
});
exports.shiftAssignmentSchema = zod_1.z.object({
    employeeId: exports.uuid,
    shiftId: exports.uuid,
    effectiveFrom: exports.dateOnly,
    effectiveTo: exports.dateOnly.optional(),
    daysOfWeek: zod_1.z.array(zod_1.z.number().int().min(0).max(6)).default([]),
});
/**
 * The one punch endpoint. Every source — today's QR and tomorrow's NFC reader —
 * posts this shape. Hardware integration is an auth adapter, not a new endpoint.
 */
exports.punchSchema = zod_1.z.object({
    branchId: exports.uuid,
    /** Identify by employee id, or by credential (card UID / QR token / device id). */
    employeeId: exports.uuid.optional(),
    credentialType: zod_1.z.enum(enums_1.CREDENTIAL_TYPES).optional(),
    credentialIdentifier: zod_1.z.string().max(200).optional(),
    pin: zod_1.z.string().regex(/^\d{4,6}$/).optional(),
    direction: zod_1.z.enum(['IN', 'OUT']),
    source: zod_1.z.enum(enums_1.ATTENDANCE_SOURCES).default('WEB'),
    deviceCode: zod_1.z.string().max(40).optional(),
    /** Device-local time. Server applies the device's known clock skew. */
    occurredAt: zod_1.z.string().datetime().optional(),
    lat: zod_1.z.number().min(-90).max(90).optional(),
    lng: zod_1.z.number().min(-180).max(180).optional(),
    accuracyM: zod_1.z.number().nonnegative().optional(),
    photoKey: zod_1.z.string().max(300).optional(),
    rawPayload: zod_1.z.record(zod_1.z.unknown()).optional(),
});
exports.correctAttendanceSchema = zod_1.z.object({
    employeeId: exports.uuid,
    workDate: exports.dateOnly,
    /** Replaces the derived in/out for the day; the originals remain in the event log. */
    firstInAt: zod_1.z.string().datetime().nullable().optional(),
    lastOutAt: zod_1.z.string().datetime().nullable().optional(),
    status: zod_1.z
        .enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'WEEKLY_OFF', 'HOLIDAY', 'LEAVE'])
        .optional(),
    reason: zod_1.z.string().min(3).max(300),
});
exports.payrollRunSchema = zod_1.z.object({
    branchId: exports.uuid,
    /** YYYY-MM */
    period: zod_1.z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});
exports.salaryAdvanceSchema = zod_1.z.object({
    employeeId: exports.uuid,
    amountMinor: zod_1.z.number().int().positive(),
    reason: zod_1.z.string().max(200).optional(),
    givenOn: exports.dateOnly.optional(),
});
// ─── Legal documents ─────────────────────────────────────────────────────────
exports.legalDocumentSchema = zod_1.z.object({
    branchId: exports.uuid.nullable().default(null),
    employeeId: exports.uuid.nullable().default(null),
    category: zod_1.z.enum(enums_1.LEGAL_DOCUMENT_CATEGORIES),
    title: zod_1.z.string().min(1).max(200),
    documentNumber: zod_1.z.string().max(80).optional(),
    issuingAuthority: zod_1.z.string().max(140).optional(),
    issuedOn: exports.dateOnly.optional(),
    expiresOn: exports.dateOnly.optional(),
    renewalLeadDays: zod_1.z.number().int().min(1).max(365).default(60),
    renewalFeeMinor: exports.minor.optional(),
    supersedesDocumentId: exports.uuid.optional(),
    tags: zod_1.z.array(zod_1.z.string().max(40)).default([]),
    notes: zod_1.z.string().max(1000).optional(),
});
// ─── Expenses & reports ──────────────────────────────────────────────────────
exports.expenseSchema = zod_1.z.object({
    branchId: exports.uuid,
    categoryId: exports.uuid,
    amountMinor: zod_1.z.number().int().positive(),
    incurredOn: exports.dateOnly,
    paymentMethod: zod_1.z.enum(['CASH', 'UPI', 'NEFT', 'CARD', 'CHEQUE']).optional(),
    reference: zod_1.z.string().max(80).optional(),
    description: zod_1.z.string().max(300).optional(),
});
exports.reportRangeSchema = zod_1.z.object({
    branchId: exports.uuid.optional(),
    from: exports.dateOnly,
    to: exports.dateOnly,
    granularity: zod_1.z.enum(['DAY', 'WEEK', 'MONTH']).default('DAY'),
});
// ─── Kitchen ─────────────────────────────────────────────────────────────────
exports.kitchenTicketQuerySchema = zod_1.z.object({
    branchId: exports.uuid,
    station: zod_1.z.enum(enums_1.KITCHEN_STATIONS).optional(),
});
