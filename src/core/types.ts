/**
 * Domain model for Kitchen Ledger.
 *
 * The whole system is an append-only stock ledger plus a set of documents that
 * write into it. Nothing mutates a balance directly: every change in stock is a
 * ledger row, so any number on any screen can be traced back to the document
 * that caused it.
 */

export type ID = string

/** Units are only ever stored in an item's base unit. Everything else converts. */
export type BaseUnit = 'g' | 'ml' | 'unit'
export type PurchaseUnit =
  | 'kg' | 'g' | 'litre' | 'ml' | 'unit' | 'packet' | 'bunch' | 'dozen' | 'box' | 'tray' | 'crate'

export interface Category {
  id: ID
  name: string
  /** null for a top-level category, otherwise the parent it sits beneath. */
  parentId: ID | null
  kind: 'INGREDIENT' | 'MENU'
  sort: number
  /** Acceptable variance before EOD flags it. Spices tolerate more than meat. */
  varianceTolerancePct?: number
}

export interface Supplier {
  id: ID
  code: string
  name: string
  contact: string
  email?: string
  gstin?: string
  leadTimeDays: number
  paymentTerms: string
  deliveryScore: number
  qualityScore: number
  categoryIds: ID[]
  active: boolean
}

export type LocationKind = 'STORE' | 'KITCHEN' | 'COLD' | 'DRY' | 'BAR'

export interface StockLocation {
  id: ID
  name: string
  kind: LocationKind
  /** Kitchen sections issue from here by default. */
  isIssuingStore: boolean
  sort: number
}

export interface Item {
  id: ID
  sku: string
  name: string
  categoryId: ID
  subCategoryId: ID | null
  baseUnit: BaseUnit
  purchaseUnit: PurchaseUnit
  /** How many base units are in one purchase unit (1 kg = 1000 g). */
  purchaseConversion: number
  /** Usable fraction after peeling / trimming / deboning. 1 = no loss. */
  yieldPct: number
  shelfLifeDays: number | null
  /** Levels held in base units. */
  parLevel: number
  reorderLevel: number
  defaultSupplierId: ID | null
  defaultLocationId: ID
  gstPct: number
  /** A prep item is produced by the kitchen, not bought (gravies, pastes, masalas). */
  isPrep: boolean
  trackBatches: boolean
  /** Weighted-average cost per base unit; recalculated on every receipt. */
  avgCost: number
  lastPurchaseCost: number
  active: boolean
  notes?: string
}

export interface Dish {
  id: ID
  code: string
  name: string
  categoryId: ID
  subCategoryId: ID | null
  price: number
  gstPct: number
  /** Costs that are real but not in the recipe. */
  packagingCost: number
  otherVariableCost: number
  /** Which kitchen section owns it — drives chef attribution. */
  sectionId: ID | null
  prepTimeMins: number
  active: boolean
  description?: string
  allergens?: string[]
}

/** A recipe line points at an ingredient item OR another recipe's output (prep). */
export interface RecipeLine {
  id: ID
  itemId: ID
  /** Quantity in the item's base unit, for one recipe yield. */
  qty: number
  /** Extra loss specific to this preparation, on top of the item's own yield. */
  wastagePct: number
  /**
   * True when `qty` is the edible-portion weight (after peeling/deboning), so
   * the item's yield is applied to find what must leave the shelf. Kitchens
   * normally weigh as-purchased, which is the default.
   */
  netBasis?: boolean
  optional: boolean
  note?: string
}

export interface SopStep {
  id: ID
  seq: number
  instruction: string
  minutes?: number
  /** Critical control point — temperature, holding time, hygiene check. */
  ccp?: string
  station?: string
}

export type RecipeOwner = 'DISH' | 'PREP'

export interface Recipe {
  id: ID
  ownerType: RecipeOwner
  /** Dish id, or the prep Item id this recipe produces. */
  ownerId: ID
  version: number
  /** Portions (dish) or base units (prep) produced by one run of this recipe. */
  yieldQty: number
  lines: RecipeLine[]
  steps: SopStep[]
  /** Plating / finishing notes shown to the chef. */
  platingNotes?: string
  standardPrepMins?: number
  updatedAt: string
  updatedBy?: string
  active: boolean
}

export type StaffRole = 'OWNER' | 'MANAGER' | 'HEAD_CHEF' | 'CHEF' | 'STORE' | 'PURCHASE' | 'ACCOUNTS'

export interface Staff {
  id: ID
  code: string
  name: string
  role: StaffRole
  /** Kitchen section — tandoor, curry, biryani, cold, bakery. */
  sectionId: ID | null
  monthlyCost: number
  shiftHours: number
  pin: string
  active: boolean
}

export interface Section {
  id: ID
  name: string
  sort: number
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

export type DocStatus = 'DRAFT' | 'POSTED' | 'VOID'

/* ------------------------------------------------------------------ */
/* Procurement: order → receive                                        */
/* ------------------------------------------------------------------ */

export type POStatus = 'DRAFT' | 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED'

export interface POLine {
  id: ID
  itemId: ID
  /** In the purchase unit the vendor quotes in. */
  qty: number
  unit: PurchaseUnit
  /** Expected rate per purchase unit; the receipt may differ. */
  rate: number
  /** Running total of what has been accepted against this line, in base units. */
  acceptedBase: number
}

/** What the purchase manager sends to a vendor. Creates no stock on its own. */
export interface PurchaseOrder {
  id: ID
  poNo: string
  supplierId: ID
  date: string
  expectedDate: string
  lines: POLine[]
  status: POStatus
  createdBy: ID | null
  sentAt?: string
  notes?: string
  createdAt: string
}

export type ReceiptIssue =
  | 'SHORT_SUPPLIED' | 'DAMAGED_IN_TRANSIT' | 'QUALITY_REJECTED' | 'WRONG_ITEM'
  | 'EXPIRED' | 'EXCESS_SUPPLIED' | 'OTHER'

export interface GRNLine {
  id: ID
  itemId: ID
  /** From the PO, or equal to received when there is no PO. */
  orderedQty: number
  /** What physically arrived, in the purchase unit. */
  receivedQty: number
  /** Portion of what arrived that was refused — never enters stock. */
  damagedQty: number
  unit: PurchaseUnit
  rate: number
  taxPct: number
  issue?: ReceiptIssue
  note?: string
  batchNo?: string
  expiryDate?: string
}

/**
 * Goods receipt: the only thing that puts purchased stock on a shelf.
 * accepted = received − damaged; missing = ordered − received.
 */
export interface GoodsReceipt {
  id: ID
  grnNo: string
  poId: ID | null
  supplierId: ID
  date: string
  locationId: ID
  lines: GRNLine[]
  invoiceNo?: string
  attachmentName?: string
  entryMode: 'PO' | 'PDF' | 'MANUAL'
  status: DocStatus
  receivedBy: ID | null
  notes?: string
  createdAt: string
}

export interface PurchaseBillLine {
  id: ID
  itemId: ID
  /** Entered in the purchase unit the buyer actually sees on the bill. */
  qty: number
  unit: PurchaseUnit
  /** Rate per purchase unit, before tax. */
  rate: number
  discount: number
  taxPct: number
  /** Free text from the source document, kept for audit + future matching. */
  rawText?: string
  batchNo?: string
  expiryDate?: string
}

export interface PurchaseBill {
  id: ID
  billNo: string
  supplierId: ID
  billDate: string
  receivedAt: string
  locationId: ID
  lines: PurchaseBillLine[]
  otherCharges: number
  roundOff: number
  status: DocStatus
  entryMode: 'PDF' | 'MANUAL' | 'PHOTO'
  attachmentName?: string
  enteredBy: ID | null
  notes?: string
  createdAt: string
}

export interface IssueLine {
  id: ID
  itemId: ID
  qty: number
  unit: PurchaseUnit | BaseUnit
  /** Resolved quantity in base units at post time. */
  qtyBase: number
  /**
   * Where this particular item actually comes from. Chicken lives in the cold
   * room and rice in the dry store, so one source location for the whole
   * document would take stock off a shelf that never held it.
   */
  fromLocationId?: ID
}

/** Store → kitchen movement. The highest-frequency document in the system. */
export interface Issue {
  id: ID
  ref: string
  date: string
  fromLocationId: ID
  toLocationId: ID
  lines: IssueLine[]
  requestedBy: ID | null
  status: DocStatus
  createdAt: string
  notes?: string
}

export interface ProductionRun {
  id: ID
  ref: string
  date: string
  /** The prep item produced. */
  itemId: ID
  recipeId: ID
  /** Multiples of the recipe yield. */
  batches: number
  qtyProduced: number
  locationId: ID
  byStaffId: ID | null
  status: DocStatus
  createdAt: string
}

export type WastageReason =
  | 'SPOILAGE' | 'EXPIRY' | 'BURNT' | 'SPILLAGE' | 'CUSTOMER_RETURN'
  | 'STAFF_MEAL' | 'COMPLIMENTARY' | 'TRIAL' | 'OTHER'

export interface Wastage {
  id: ID
  ref: string
  date: string
  itemId: ID
  locationId: ID
  qtyBase: number
  reason: WastageReason
  byStaffId: ID | null
  note?: string
  createdAt: string
}

export interface SalesLine {
  id: ID
  dishId: ID
  qty: number
  grossAmount: number
  discount: number
  /** Which chef / section produced it — drives chef P&L. */
  chefId: ID | null
}

export type OrderChannel = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'AGGREGATOR'

export interface SalesDay {
  id: ID
  date: string
  channel: OrderChannel
  lines: SalesLine[]
  covers: number
  status: DocStatus
  source: 'MANUAL' | 'POS_IMPORT' | 'SEED'
  createdAt: string
}

export interface StocktakeLine {
  id: ID
  itemId: ID
  countedQtyBase: number
  /** System quantity frozen at the moment of counting. */
  systemQtyBase: number
  note?: string
}

export interface Stocktake {
  id: ID
  ref: string
  date: string
  locationId: ID
  lines: StocktakeLine[]
  countedBy: ID | null
  status: DocStatus
  createdAt: string
}

/** The EOD close ties sales, issues, wastage and the physical count together. */
export interface DayClose {
  id: ID
  date: string
  status: 'OPEN' | 'REVIEW' | 'CLOSED'
  salesPosted: boolean
  consumptionPosted: boolean
  stocktakeIds: ID[]
  closedBy: ID | null
  closedAt?: string
  /** Manager's explanation for material variances. */
  notes?: string
}

/* ------------------------------------------------------------------ */
/* Alerts — what the system tells the manager                          */
/* ------------------------------------------------------------------ */

export type AlertKind =
  | 'VARIANCE' | 'RECEIPT_ISSUE' | 'PO_OVERDUE' | 'LOW_STOCK' | 'PRICE_JUMP'
  | 'NEGATIVE_STOCK' | 'COUNT_MISSING' | 'WASTAGE_HIGH'

export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'

export interface Alert {
  id: ID
  /** Stable key so re-running the engine updates rather than duplicates. */
  key: string
  date: string
  kind: AlertKind
  severity: Exclude<Severity, 'OK'>
  title: string
  detail: string
  /** Rupee impact — what this is costing or putting at risk. */
  impact: number
  itemId?: ID
  refType?: string
  refId?: ID
  status: AlertStatus
  createdAt: string
  actedBy?: ID | null
  actedAt?: string
  note?: string
}

/* ------------------------------------------------------------------ */
/* Ledger                                                              */
/* ------------------------------------------------------------------ */

export type MovementType =
  | 'OPENING'
  | 'RECEIPT'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'CONSUMPTION'
  | 'PRODUCTION_IN'
  | 'PRODUCTION_OUT'
  | 'WASTAGE'
  | 'ADJUSTMENT'
  | 'RETURN'

export interface Movement {
  id: ID
  /** Business date, not wall-clock — a 1 a.m. close belongs to the prior day. */
  date: string
  ts: string
  itemId: ID
  locationId: ID
  /** Signed, always in the item's base unit. */
  qty: number
  type: MovementType
  /** Cost per base unit at the time of the movement. */
  rate: number
  value: number
  refType: 'BILL' | 'GRN' | 'ISSUE' | 'SALES' | 'PRODUCTION' | 'WASTAGE' | 'STOCKTAKE' | 'OPENING'
  refId: ID
  staffId: ID | null
  batchNo?: string
  note?: string
}

/* ------------------------------------------------------------------ */
/* Derived / reporting shapes                                          */
/* ------------------------------------------------------------------ */

export interface CostedLine {
  itemId: ID
  name: string
  sku: string
  baseUnit: BaseUnit
  /** Gross quantity drawn from stock, after yield and wastage. */
  qty: number
  /** Net quantity in the finished dish. */
  netQty: number
  unitCost: number
  cost: number
  isPrep: boolean
  depth: number
}

export interface DishCosting {
  dishId: ID
  name: string
  price: number
  netPrice: number
  foodCost: number
  packagingCost: number
  otherVariableCost: number
  variableCost: number
  contribution: number
  foodCostPct: number
  contributionPct: number
  lines: CostedLine[]
}

export interface VarianceRow {
  itemId: ID
  name: string
  sku: string
  categoryId: ID
  baseUnit: BaseUnit
  opening: number
  received: number
  transferredIn: number
  transferredOut: number
  theoretical: number
  wastage: number
  expectedClosing: number
  actualClosing: number
  varianceQty: number
  variancePct: number
  varianceValue: number
  unitCost: number
  severity: Severity
  /** Trailing mean variance % for the same item, for deviation-from-normal. */
  avgVariancePct: number | null
  deviation: number | null
}

export type Severity = 'OK' | 'WATCH' | 'HIGH' | 'CRITICAL'

export interface ChefScorecard {
  chefId: ID
  name: string
  role: StaffRole
  sectionName: string
  dishesSold: number
  revenue: number
  theoreticalFoodCost: number
  actualFoodCost: number
  varianceLeak: number
  wastage: number
  packagingCost: number
  contribution: number
  contributionPct: number
  theoreticalFoodCostPct: number
  actualFoodCostPct: number
  labourCost: number
  netContribution: number
  contributionPerHour: number
  efficiencyIndex: number
  rank: number
}
