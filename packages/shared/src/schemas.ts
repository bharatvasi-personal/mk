/**
 * Wire contracts, as Zod objects.
 *
 * The API validates requests with these; the web app builds forms and typed
 * fetchers from the same objects; a future React Native app imports them
 * unchanged. One definition, three consumers, no drift.
 */
import { z } from 'zod';
import {
  ATTENDANCE_SOURCES,
  BUYING_RHYTHMS,
  CREDENTIAL_TYPES,
  EMPLOYEE_ROLE_TYPES,
  EMPLOYMENT_TYPES,
  FOOD_TYPES,
  INVENTORY_CATEGORIES,
  KITCHEN_STATIONS,
  LEGAL_DOCUMENT_CATEGORIES,
  MEAL_SLOTS,
  ORDER_CHANNELS,
  STOCK_MOVEMENT_REASONS,
  TENDER_TYPES,
} from './enums';
import { ROLES } from './rbac';

export const uuid = z.string().uuid();
/** Indian mobile: 10 digits starting 6–9, with an optional +91. */
export const phone = z
  .string()
  .trim()
  .regex(/^(\+91)?[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number');
export const minor = z.number().int().nonnegative();
/** Quantities cross the wire as strings to survive Decimal without float loss. */
export const qty = z
  .union([z.number(), z.string()])
  .transform((v) => String(v))
  .refine((v) => /^-?\d+(\.\d{1,4})?$/.test(v), 'Up to 4 decimal places');
export const localeCode = z.enum(['en', 'hi', 'te']);
export const i18nText = z.record(z.string()).default({});
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type Pagination = z.infer<typeof paginationSchema>;

// ─── Auth ────────────────────────────────────────────────────────────────────

export const staffLoginSchema = z.object({
  tenantSlug: z.string().min(1),
  /** Email or phone — staff remember one or the other, not reliably both. */
  identifier: z.string().min(3),
  password: z.string().min(8),
  totpCode: z.string().length(6).optional(),
  client: z.enum(['WEB', 'POS', 'MOBILE']).default('WEB'),
});

export const requestOtpSchema = z.object({ tenantSlug: z.string().min(1), phone });
export const verifyOtpSchema = z.object({
  tenantSlug: z.string().min(1),
  phone,
  code: z.string().length(6),
  name: z.string().min(1).max(80).optional(),
});
export const refreshSchema = z.object({ refreshToken: z.string().optional() });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z
    .string()
    .min(10, 'At least 10 characters')
    .regex(/[a-z]/, 'Needs a lowercase letter')
    .regex(/[A-Z]/, 'Needs an uppercase letter')
    .regex(/\d/, 'Needs a digit'),
});

// ─── Menu ────────────────────────────────────────────────────────────────────

export const menuCategorySchema = z.object({
  name: z.string().min(1).max(80),
  nameI18n: i18nText,
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  mealSlot: z.enum(MEAL_SLOTS).default('ALL_DAY'),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const menuItemSchema = z.object({
  categoryId: uuid,
  name: z.string().min(1).max(120),
  nameI18n: i18nText,
  description: z.string().max(600).optional(),
  descriptionI18n: i18nText,
  foodType: z.enum(FOOD_TYPES).default('VEG'),
  isLessOil: z.boolean().default(false),
  isMithilaSpecial: z.boolean().default(false),
  isChefSpecial: z.boolean().default(false),
  spiceLevel: z.number().int().min(0).max(3).optional(),
  allergens: z.array(z.string()).default([]),
  targetFoodCostPct: z.number().int().min(1).max(100).optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  variants: z
    .array(
      z.object({
        id: uuid.optional(),
        name: z.string().min(1).max(40),
        nameI18n: i18nText,
        isDefault: z.boolean().default(false),
        sortOrder: z.number().int().default(0),
      }),
    )
    .min(1, 'At least one variant — use "Regular" if the item has no sizes'),
});

/** Price lives per branch × variant × meal slot. This is the row the POS reads. */
export const branchMenuPriceSchema = z.object({
  branchId: uuid,
  variantId: uuid,
  mealSlot: z.enum(MEAL_SLOTS),
  priceMinor: minor,
  compareAtPriceMinor: minor.optional(),
  gstRateBp: z.number().int().min(0).max(2800).default(500),
  isAvailable: z.boolean().default(true),
  dailyLimit: z.number().int().positive().optional(),
});

export const setSoldOutSchema = z.object({
  branchMenuItemId: uuid,
  /** null clears the flag; otherwise sold out until this instant (usually end of day). */
  soldOutUntil: z.string().datetime().nullable(),
});

// ─── Orders / POS ────────────────────────────────────────────────────────────

export const orderLineInputSchema = z.object({
  variantId: uuid,
  qty: z.number().int().min(1).max(200),
  notes: z.string().max(200).optional(),
});

export const createOrderSchema = z.object({
  branchId: uuid,
  /** UUID minted by the POS before it has a network. Makes retries idempotent. */
  clientRef: uuid,
  channel: z.enum(ORDER_CHANNELS),
  mealSlot: z.enum(MEAL_SLOTS),
  tableId: uuid.optional(),
  customerName: z.string().max(80).optional(),
  customerPhone: phone.optional(),
  guestCount: z.number().int().min(1).max(50).optional(),
  pickupAt: z.string().datetime().optional(),
  notes: z.string().max(400).optional(),
  items: z.array(orderLineInputSchema).min(1),
  /** POS-only. Discounts require `order:discount`. */
  discountMinor: minor.default(0),
  discountReason: z.string().max(120).optional(),
});

export const tenderSchema = z.object({
  tender: z.enum(TENDER_TYPES),
  amountMinor: z.number().int().positive(),
  /** Cash only — used to compute change. */
  tenderedMinor: minor.optional(),
  /** UPI UTR / card auth code. Required for UPI_MANUAL so the bank statement reconciles. */
  reference: z.string().max(60).optional(),
});

export const settleOrderSchema = z
  .object({
    orderId: uuid,
    tenders: z.array(tenderSchema).min(1),
    roundOff: z.boolean().default(true),
    printBill: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    for (const t of v.tenders) {
      if (t.tender === 'UPI_MANUAL' && !t.reference) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tenders'],
          message: 'A UPI reference (UTR) is required so the bank statement can be reconciled',
        });
      }
    }
  });

/**
 * Create and settle in one call.
 *
 * This is the POS's primary primitive, not a shortcut: at a thali counter the customer
 * orders and pays in the same breath, and a two-round-trip flow doubles the number of
 * ways a dropped connection can leave a half-finished bill. It is also what makes the
 * offline queue tractable — one idempotent operation to replay instead of an ordered
 * pair where the second needs an id the first has not returned yet.
 *
 * Dine-in customers who pay after eating still use the two-step flow.
 */
export const quickBillSchema = createOrderSchema
  .extend({
    tenders: z.array(tenderSchema).min(1),
    roundOff: z.boolean().default(true),
    sendToKitchen: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    for (const t of v.tenders) {
      if (t.tender === 'UPI_MANUAL' && !t.reference) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tenders'],
          message: 'A UPI reference (UTR) is required so the bank statement can be reconciled',
        });
      }
    }
  });

export const voidOrderItemSchema = z.object({
  orderId: uuid,
  orderItemId: uuid,
  reason: z.string().min(3).max(200),
});

export const cancelOrderSchema = z.object({ orderId: uuid, reason: z.string().min(3).max(200) });

export const updateOrderStatusSchema = z.object({
  orderId: uuid,
  status: z.enum(['CONFIRMED', 'PREPARING', 'READY', 'SERVED']),
});

export const openCashSessionSchema = z.object({
  branchId: uuid,
  openingFloatMinor: minor,
});

export const closeCashSessionSchema = z.object({
  cashSessionId: uuid,
  countedCashMinor: minor,
  /** { "500": 4, "200": 3, "100": 11, ... } — a real cash-up, not a single number. */
  denominationCount: z.record(z.coerce.number().int().nonnegative()).optional(),
  notes: z.string().max(400).optional(),
});

// ─── Online ordering (customer) ──────────────────────────────────────────────

export const publicOrderSchema = z.object({
  branchId: uuid,
  clientRef: uuid,
  mealSlot: z.enum(MEAL_SLOTS),
  items: z.array(orderLineInputSchema).min(1),
  pickupAt: z.string().datetime(),
  notes: z.string().max(300).optional(),
});

export const paymentIntentSchema = z.object({ orderId: uuid });

// ─── Inventory ───────────────────────────────────────────────────────────────

export const inventoryItemSchema = z.object({
  sku: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  nameI18n: i18nText,
  category: z.enum(INVENTORY_CATEGORIES),
  uomId: uuid,
  buyingRhythm: z.enum(BUYING_RHYTHMS).default('WEEKLY'),
  shelfLifeDays: z.number().int().positive().optional(),
  isTracked: z.boolean().default(true),
  isActive: z.boolean().default(true),
  notes: z.string().max(400).optional(),
});

export const branchStockPolicySchema = z.object({
  branchId: uuid,
  inventoryItemId: uuid,
  reorderPointQty: qty,
  parLevelQty: qty,
  preferredVendorId: uuid.optional(),
  storageLocation: z.string().max(60).optional(),
});

/** Manual movement: wastage, staff meal, opening balance. Purchases go through a GRN. */
export const stockMovementSchema = z.object({
  branchId: uuid,
  inventoryItemId: uuid,
  qtyDelta: qty,
  reason: z.enum(STOCK_MOVEMENT_REASONS),
  note: z.string().max(300).optional(),
  occurredAt: z.string().datetime().optional(),
});

export const recipeSchema = z.object({
  menuItemId: uuid,
  variantId: uuid.nullable().default(null),
  yieldQty: qty.default('1'),
  notes: z.string().max(400).optional(),
  lines: z
    .array(
      z.object({
        inventoryItemId: uuid,
        qty,
        uomId: uuid,
        wastagePct: z.number().int().min(0).max(100).default(0),
        isOptional: z.boolean().default(false),
      }),
    )
    .min(1),
});

export const stockCountSchema = z.object({
  branchId: uuid,
  countedOn: dateOnly,
  scope: z.string().max(40).optional(),
  notes: z.string().max(400).optional(),
  lines: z
    .array(z.object({ inventoryItemId: uuid, countedQty: qty, reason: z.string().max(200).optional() }))
    .min(1),
});

// ─── Vendors & purchasing ────────────────────────────────────────────────────

export const vendorSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(140),
  contactName: z.string().max(80).optional(),
  phone: phone.optional(),
  altPhone: phone.optional(),
  email: z.string().email().optional(),
  addressLine1: z.string().max(200).optional(),
  city: z.string().max(60).optional(),
  pincode: z.string().regex(/^\d{6}$/).optional(),
  gstin: z
    .string()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]Z[A-Z\d]$/, 'Not a valid GSTIN')
    .optional(),
  category: z.string().max(60).optional(),
  creditDays: z.number().int().min(0).max(180).default(0),
  creditLimitMinor: minor.optional(),
  upiId: z.string().max(80).optional(),
  notes: z.string().max(400).optional(),
  isActive: z.boolean().default(true),
});

export const purchaseOrderSchema = z.object({
  branchId: uuid,
  vendorId: uuid,
  expectedOn: dateOnly.optional(),
  notes: z.string().max(400).optional(),
  lines: z
    .array(
      z.object({
        inventoryItemId: uuid,
        orderedQty: qty,
        unitPriceMinor: minor,
        gstRateBp: z.number().int().min(0).max(2800).default(0),
      }),
    )
    .min(1),
});

export const goodsReceiptSchema = z.object({
  branchId: uuid,
  purchaseOrderId: uuid.optional(),
  vendorId: uuid,
  receivedOn: dateOnly.optional(),
  /** The vendor's paper bill. Optional at receipt time; often arrives later. */
  billNo: z.string().max(60).optional(),
  billDate: dateOnly.optional(),
  billPhotoKey: z.string().max(300).optional(),
  notes: z.string().max(400).optional(),
  lines: z
    .array(
      z.object({
        inventoryItemId: uuid,
        purchaseOrderLineId: uuid.optional(),
        receivedQty: qty,
        rejectedQty: qty.default('0'),
        unitPriceMinor: minor,
        batchNo: z.string().max(60).optional(),
        expiryOn: dateOnly.optional(),
      }),
    )
    .min(1),
});

export const vendorPaymentSchema = z.object({
  vendorId: uuid,
  amountMinor: z.number().int().positive(),
  method: z.enum(['CASH', 'UPI', 'NEFT', 'IMPS', 'CHEQUE']),
  reference: z.string().max(80).optional(),
  paidOn: dateOnly.optional(),
  notes: z.string().max(300).optional(),
  /** Which bills this settles. Left empty, it is applied oldest-first. */
  allocations: z.array(z.object({ vendorInvoiceId: uuid, amountMinor: z.number().int().positive() })).default([]),
});

// ─── Employees, attendance, payroll ─────────────────────────────────────────

export const employeeSchema = z.object({
  branchId: uuid,
  employeeCode: z.string().min(1).max(30),
  name: z.string().min(1).max(120),
  phone: phone.optional(),
  altPhone: phone.optional(),
  addressLine1: z.string().max(200).optional(),
  emergencyContactName: z.string().max(80).optional(),
  emergencyContactPhone: phone.optional(),
  dateOfBirth: dateOnly.optional(),
  roleType: z.enum(EMPLOYEE_ROLE_TYPES),
  employmentType: z.enum(EMPLOYMENT_TYPES).default('FULL_TIME'),
  joinedOn: dateOnly,
  idProofType: z.enum(['VOTER_ID', 'DRIVING_LICENSE', 'PASSPORT', 'RATION_CARD', 'OTHER']).optional(),
  /** Last four digits only. Aadhaar is deliberately not accepted. */
  idProofLast4: z.string().regex(/^\d{4}$/).optional(),
  weeklyOffDay: z.number().int().min(0).max(6).optional(),
  notes: z.string().max(400).optional(),
  isActive: z.boolean().default(true),
});

export const salaryStructureSchema = z
  .object({
    employeeId: uuid,
    effectiveFrom: dateOnly,
    basis: z.enum(['MONTHLY', 'DAILY']),
    monthlyGrossMinor: minor.optional(),
    dailyRateMinor: minor.optional(),
    components: z.record(minor).default({}),
    overtimeRateMultiplier: z.number().min(1).max(3).default(2),
    payDayOfMonth: z.number().int().min(1).max(28).default(10),
  })
  .refine((v) => (v.basis === 'MONTHLY' ? !!v.monthlyGrossMinor : !!v.dailyRateMinor), {
    message: 'Monthly basis needs a monthly gross; daily basis needs a daily rate',
  });

export const shiftSchema = z.object({
  branchId: uuid,
  name: z.string().min(1).max(40),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  breakMinutes: z.number().int().min(0).max(240).default(0),
  graceMinutes: z.number().int().min(0).max(60).default(10),
  fullDayMinutes: z.number().int().min(60).max(960).default(480),
  isActive: z.boolean().default(true),
});

export const shiftAssignmentSchema = z.object({
  employeeId: uuid,
  shiftId: uuid,
  effectiveFrom: dateOnly,
  effectiveTo: dateOnly.optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
});

/**
 * The one punch endpoint. Every source — today's QR and tomorrow's NFC reader —
 * posts this shape. Hardware integration is an auth adapter, not a new endpoint.
 */
export const punchSchema = z.object({
  branchId: uuid,
  /** Identify by employee id, or by credential (card UID / QR token / device id). */
  employeeId: uuid.optional(),
  credentialType: z.enum(CREDENTIAL_TYPES).optional(),
  credentialIdentifier: z.string().max(200).optional(),
  pin: z.string().regex(/^\d{4,6}$/).optional(),
  direction: z.enum(['IN', 'OUT']),
  source: z.enum(ATTENDANCE_SOURCES).default('WEB'),
  deviceCode: z.string().max(40).optional(),
  /** Device-local time. Server applies the device's known clock skew. */
  occurredAt: z.string().datetime().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracyM: z.number().nonnegative().optional(),
  photoKey: z.string().max(300).optional(),
  rawPayload: z.record(z.unknown()).optional(),
});

export const correctAttendanceSchema = z.object({
  employeeId: uuid,
  workDate: dateOnly,
  /** Replaces the derived in/out for the day; the originals remain in the event log. */
  firstInAt: z.string().datetime().nullable().optional(),
  lastOutAt: z.string().datetime().nullable().optional(),
  status: z
    .enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'WEEKLY_OFF', 'HOLIDAY', 'LEAVE'])
    .optional(),
  reason: z.string().min(3).max(300),
});

export const payrollRunSchema = z.object({
  branchId: uuid,
  /** YYYY-MM */
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

export const salaryAdvanceSchema = z.object({
  employeeId: uuid,
  amountMinor: z.number().int().positive(),
  reason: z.string().max(200).optional(),
  givenOn: dateOnly.optional(),
});

// ─── Legal documents ─────────────────────────────────────────────────────────

export const legalDocumentSchema = z.object({
  branchId: uuid.nullable().default(null),
  employeeId: uuid.nullable().default(null),
  category: z.enum(LEGAL_DOCUMENT_CATEGORIES),
  title: z.string().min(1).max(200),
  documentNumber: z.string().max(80).optional(),
  issuingAuthority: z.string().max(140).optional(),
  issuedOn: dateOnly.optional(),
  expiresOn: dateOnly.optional(),
  renewalLeadDays: z.number().int().min(1).max(365).default(60),
  renewalFeeMinor: minor.optional(),
  supersedesDocumentId: uuid.optional(),
  tags: z.array(z.string().max(40)).default([]),
  notes: z.string().max(1000).optional(),
});

// ─── Expenses & reports ──────────────────────────────────────────────────────

export const expenseSchema = z.object({
  branchId: uuid,
  categoryId: uuid,
  amountMinor: z.number().int().positive(),
  incurredOn: dateOnly,
  paymentMethod: z.enum(['CASH', 'UPI', 'NEFT', 'CARD', 'CHEQUE']).optional(),
  reference: z.string().max(80).optional(),
  description: z.string().max(300).optional(),
});

export const reportRangeSchema = z.object({
  branchId: uuid.optional(),
  from: dateOnly,
  to: dateOnly,
  granularity: z.enum(['DAY', 'WEEK', 'MONTH']).default('DAY'),
});

// ─── Kitchen ─────────────────────────────────────────────────────────────────

export const kitchenTicketQuerySchema = z.object({
  branchId: uuid,
  station: z.enum(KITCHEN_STATIONS).optional(),
});

export type StaffLoginInput = z.infer<typeof staffLoginSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type SettleOrderInput = z.infer<typeof settleOrderSchema>;
export type QuickBillInput = z.infer<typeof quickBillSchema>;
export type PunchInput = z.infer<typeof punchSchema>;
export type GoodsReceiptInput = z.infer<typeof goodsReceiptSchema>;
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;
export type RecipeInput = z.infer<typeof recipeSchema>;
export type LegalDocumentInput = z.infer<typeof legalDocumentSchema>;
export type EmployeeInput = z.infer<typeof employeeSchema>;
export type VendorInput = z.infer<typeof vendorSchema>;
export type MenuItemInput = z.infer<typeof menuItemSchema>;
