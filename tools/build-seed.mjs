/**
 * Builds src/core/seed/masters.json from the realistic masters captured in
 * tools/masters.json, remapped onto the new schema and extended with a wider
 * menu, kitchen sections and staff so the analytics have something to say.
 */
import fs from 'node:fs'

const src = JSON.parse(fs.readFileSync('tools/masters.json', 'utf8'))
const srcRecipes = JSON.parse(fs.readFileSync('tools/recipes.json', 'utf8'))

/* ---------------- categories ---------------- */
const CAT = []
let catSort = 0
const cat = (id, name, parentId, kind, tol) => {
  CAT.push({ id, name, parentId, kind, sort: catSort++, varianceTolerancePct: tol })
  return id
}

const ING = [
  ['cat_veg', 'Vegetables', 4, ['Fresh Vegetables', 'Herbs & Leaves', 'Exotic Vegetables']],
  ['cat_dairy', 'Dairy', 2, ['Milk & Cream', 'Cheese & Paneer', 'Fats']],
  ['cat_meat', 'Meat & Poultry', 1.5, ['Poultry', 'Red Meat', 'Eggs']],
  ['cat_sea', 'Seafood', 2, ['Fish', 'Shellfish']],
  ['cat_spice', 'Spices', 6, ['Whole Spices', 'Ground Spices', 'Masala Blends']],
  ['cat_staple', 'Staples', 2.5, ['Rice & Grains', 'Flours', 'Pulses', 'Oils & Fats', 'Sugar & Salt']],
  ['cat_dry', 'Dry Goods', 3, ['Nuts & Dried Fruit', 'Dessert Mixes', 'Premium & Imported']],
  ['cat_cond', 'Condiments & Sauces', 4, ['Sauces', 'Pickles & Chutneys']],
  ['cat_bev', 'Beverage Stock', 3, ['Hot Beverage Base', 'Cold Beverage Base']],
  ['cat_pkg', 'Packaging', 2, ['Containers', 'Bags & Wraps']],
  ['cat_prep', 'Kitchen Prep', 4, ['Gravies', 'Pastes', 'Masala Blends', 'Garnishes']],
]
const sub = {}
for (const [id, name, tol, subs] of ING) {
  cat(id, name, null, 'INGREDIENT', tol)
  for (const s of subs) {
    const sid = `${id}_${s.toLowerCase().replace(/[^a-z]+/g, '')}`
    cat(sid, s, id, 'INGREDIENT', tol)
    sub[`${id}|${s}`] = sid
  }
}

const MENU_CATS = [
  ['mc_starter', 'Starters', ['Veg Starters', 'Non-Veg Starters']],
  ['mc_biryani', 'Biryani', ['Veg Biryani', 'Non-Veg Biryani']],
  ['mc_main', 'Main Course', ['Veg Gravy', 'Non-Veg Gravy']],
  ['mc_bread', 'Rice & Breads', ['Breads', 'Rice']],
  ['mc_dessert', 'Desserts', ['Indian Sweets']],
  ['mc_bev', 'Beverages', ['Hot', 'Cold']],
]
for (const [id, name, subs] of MENU_CATS) {
  cat(id, name, null, 'MENU')
  for (const s of subs) {
    const sid = `${id}_${s.toLowerCase().replace(/[^a-z]+/g, '')}`
    cat(sid, s, id, 'MENU')
    sub[`${id}|${s}`] = sid
  }
}

/* ---------------- locations, sections, staff ---------------- */
const LOCATIONS = [
  { id: 'loc_store', name: 'Main Store', kind: 'STORE', isIssuingStore: true, sort: 1 },
  { id: 'loc_cold', name: 'Cold Storage', kind: 'COLD', isIssuingStore: true, sort: 2 },
  { id: 'loc_dry', name: 'Dry Store', kind: 'DRY', isIssuingStore: true, sort: 3 },
  { id: 'loc_kitchen', name: 'Kitchen', kind: 'KITCHEN', isIssuingStore: false, sort: 4 },
]
const LOC_MAP = { 1: 'loc_store', 2: 'loc_kitchen', 3: 'loc_cold', 4: 'loc_dry' }

const SECTIONS = [
  { id: 'sec_tandoor', name: 'Tandoor', sort: 1 },
  { id: 'sec_curry', name: 'Curry', sort: 2 },
  { id: 'sec_biryani', name: 'Biryani & Rice', sort: 3 },
  { id: 'sec_bread', name: 'Breads', sort: 4 },
  { id: 'sec_wok', name: 'Wok / Chinese', sort: 5 },
  { id: 'sec_pastry', name: 'Pastry & Beverage', sort: 6 },
]

const STAFF = [
  { id: 'stf_owner', code: 'MGR-01', name: 'Rakesh Menon', role: 'OWNER', sectionId: null, monthlyCost: 0, shiftHours: 9, pin: '1111' },
  { id: 'stf_mgr', code: 'MGR-02', name: 'Divya Suresh', role: 'MANAGER', sectionId: null, monthlyCost: 55000, shiftHours: 10, pin: '2222' },
  { id: 'stf_head', code: 'CHF-01', name: 'Imran Qureshi', role: 'HEAD_CHEF', sectionId: 'sec_biryani', monthlyCost: 72000, shiftHours: 10, pin: '3333' },
  { id: 'stf_c2', code: 'CHF-02', name: 'Vinod Kumar', role: 'CHEF', sectionId: 'sec_curry', monthlyCost: 46000, shiftHours: 9, pin: '3434' },
  { id: 'stf_c3', code: 'CHF-03', name: 'Salim Basha', role: 'CHEF', sectionId: 'sec_tandoor', monthlyCost: 44000, shiftHours: 9, pin: '3535' },
  { id: 'stf_c4', code: 'CHF-04', name: 'Anand Pillai', role: 'CHEF', sectionId: 'sec_wok', monthlyCost: 40000, shiftHours: 9, pin: '3636' },
  { id: 'stf_c5', code: 'CHF-05', name: 'Mahesh Yadav', role: 'CHEF', sectionId: 'sec_bread', monthlyCost: 32000, shiftHours: 9, pin: '3737' },
  { id: 'stf_c6', code: 'CHF-06', name: 'Priya Nair', role: 'CHEF', sectionId: 'sec_pastry', monthlyCost: 36000, shiftHours: 8, pin: '3838' },
  { id: 'stf_store', code: 'STR-01', name: 'Ganesh Rao', role: 'STORE', sectionId: null, monthlyCost: 28000, shiftHours: 9, pin: '4444' },
  { id: 'stf_acc', code: 'ACC-01', name: 'Fathima Zohra', role: 'ACCOUNTS', sectionId: null, monthlyCost: 34000, shiftHours: 8, pin: '5555' },
].map((s) => ({ ...s, active: true }))

/* ---------------- suppliers ---------------- */
const SUP_MAP = {}
const SUPPLIERS = src.suppliers.map((s, i) => {
  const id = `sup_${s.id}`
  SUP_MAP[s.id] = id
  return {
    id, code: `SUP-${String(i + 1).padStart(3, '0')}`, name: s.name, contact: s.contact,
    email: `${s.name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.in`,
    gstin: `29ABCDE${1000 + i}F1Z${i}`,
    leadTimeDays: s.lead_time_days, paymentTerms: s.payment_terms,
    deliveryScore: s.delivery_score, qualityScore: s.quality_score,
    categoryIds: [], active: true,
  }
})
SUPPLIERS.push({
  id: 'sup_bev', code: 'SUP-007', name: 'Sunrise Beverage Traders', contact: '98450 44556',
  email: 'sunrise.bev@example.in', gstin: '29ABCDE9001F1Z7', leadTimeDays: 2,
  paymentTerms: 'Net 15', deliveryScore: 91, qualityScore: 93, categoryIds: [], active: true,
})

/* ---------------- items ---------------- */
// SKU → [category, subcategory] for the 40 items carried over.
const MAP = {
  'CHK-001': ['cat_meat', 'Poultry'], 'MUT-001': ['cat_meat', 'Red Meat'],
  'FSH-001': ['cat_sea', 'Fish'],
  'BTR-001': ['cat_dairy', 'Fats'], 'CRD-001': ['cat_dairy', 'Milk & Cream'],
  'CRM-001': ['cat_dairy', 'Milk & Cream'], 'MLK-001': ['cat_dairy', 'Milk & Cream'],
  'PNR-001': ['cat_dairy', 'Cheese & Paneer'],
  'DRY-001': ['cat_dry', 'Nuts & Dried Fruit'], 'SWT-001': ['cat_dry', 'Dessert Mixes'],
  'DRY-002': ['cat_dry', 'Premium & Imported'],
  'PRP-001': ['cat_prep', 'Gravies'], 'PRP-002': ['cat_prep', 'Masala Blends'],
  'PRP-003': ['cat_prep', 'Pastes'],
  'PKG-001': ['cat_pkg', 'Containers'], 'PKG-002': ['cat_pkg', 'Containers'],
  'PKG-003': ['cat_pkg', 'Bags & Wraps'],
  'SPC-001': ['cat_spice', 'Masala Blends'], 'SPC-002': ['cat_spice', 'Masala Blends'],
  'SPC-003': ['cat_spice', 'Ground Spices'], 'SPC-004': ['cat_spice', 'Ground Spices'],
  'SPC-005': ['cat_spice', 'Ground Spices'], 'SPC-006': ['cat_spice', 'Whole Spices'],
  'SPC-007': ['cat_spice', 'Whole Spices'],
  'RIC-001': ['cat_staple', 'Rice & Grains'], 'ATA-001': ['cat_staple', 'Flours'],
  'URD-001': ['cat_staple', 'Pulses'], 'GHE-001': ['cat_staple', 'Oils & Fats'],
  'OIL-001': ['cat_staple', 'Oils & Fats'], 'SLT-001': ['cat_staple', 'Sugar & Salt'],
  'SUG-001': ['cat_staple', 'Sugar & Salt'],
}
const vegSubs = {
  'VEG-007': 'Herbs & Leaves', 'VEG-010': 'Herbs & Leaves',
}
const ITEM_MAP = {}
const ITEMS = src.items.map((i) => {
  const id = `itm_${i.sku.toLowerCase().replace(/[^a-z0-9]/g, '')}`
  ITEM_MAP[i.id] = id
  let [c, s] = MAP[i.sku] ?? ['cat_veg', vegSubs[i.sku] ?? 'Fresh Vegetables']
  return {
    id, sku: i.sku, name: i.name, categoryId: c, subCategoryId: sub[`${c}|${s}`] ?? null,
    baseUnit: i.base_unit === 'unit' ? 'unit' : i.base_unit,
    purchaseUnit: i.purchase_unit, purchaseConversion: i.purchase_conversion,
    yieldPct: i.yield_pct ?? 1, shelfLifeDays: i.shelf_life_days ?? null,
    parLevel: i.par_level_base ?? 0, reorderLevel: i.min_stock_base ?? 0,
    defaultSupplierId: i.default_supplier_id ? SUP_MAP[i.default_supplier_id] : null,
    defaultLocationId: LOC_MAP[i.storage_location_id] ?? 'loc_dry',
    gstPct: i.gst_pct ?? 5, isPrep: !!i.is_prep, trackBatches: !!i.track_batches,
    avgCost: i.unit_cost ?? 0, lastPurchaseCost: i.unit_cost ?? 0, active: true,
  }
})

/** Extra items needed by the widened menu. */
const EXTRA = [
  ['PRW-001', 'Prawns (medium)', 'cat_sea', 'Shellfish', 'g', 'kg', 1000, 0.65, 2, 0.62, 'sup_5', 'loc_cold', 6000, 1500],
  ['EGG-001', 'Eggs', 'cat_meat', 'Eggs', 'unit', 'tray', 30, 1, 21, 6.2, 'sup_3', 'loc_cold', 300, 90],
  ['VEG-011', 'Mushroom', 'cat_veg', 'Exotic Vegetables', 'g', 'kg', 1000, 0.92, 5, 0.21, 'sup_2', 'loc_store', 4000, 1200],
  ['VEG-012', 'Baby Corn', 'cat_veg', 'Exotic Vegetables', 'g', 'kg', 1000, 0.88, 7, 0.16, 'sup_2', 'loc_store', 3000, 900],
  ['VEG-013', 'Cauliflower', 'cat_veg', 'Fresh Vegetables', 'g', 'kg', 1000, 0.7, 6, 0.048, 'sup_2', 'loc_store', 8000, 2500],
  ['VEG-014', 'Cabbage', 'cat_veg', 'Fresh Vegetables', 'g', 'kg', 1000, 0.8, 10, 0.032, 'sup_2', 'loc_store', 6000, 1800],
  ['VEG-015', 'Carrot', 'cat_veg', 'Fresh Vegetables', 'g', 'kg', 1000, 0.85, 14, 0.052, 'sup_2', 'loc_store', 7000, 2000],
  ['VEG-016', 'French Beans', 'cat_veg', 'Fresh Vegetables', 'g', 'kg', 1000, 0.88, 5, 0.068, 'sup_2', 'loc_store', 4000, 1200],
  ['VEG-017', 'Spinach (Palak)', 'cat_veg', 'Herbs & Leaves', 'g', 'kg', 1000, 0.6, 3, 0.045, 'sup_2', 'loc_store', 9000, 2500],
  ['VEG-018', 'Lemon', 'cat_veg', 'Fresh Vegetables', 'unit', 'unit', 1, 1, 14, 4.5, 'sup_2', 'loc_store', 400, 120],
  ['VEG-019', 'Spring Onion', 'cat_veg', 'Herbs & Leaves', 'g', 'kg', 1000, 0.75, 4, 0.082, 'sup_2', 'loc_store', 3000, 900],
  ['FLR-002', 'Maida (Refined Flour)', 'cat_staple', 'Flours', 'g', 'kg', 1000, 1, 120, 0.044, 'sup_4', 'loc_dry', 25000, 7000],
  ['FLR-003', 'Corn Flour', 'cat_staple', 'Flours', 'g', 'kg', 1000, 1, 180, 0.062, 'sup_4', 'loc_dry', 8000, 2000],
  ['SAU-001', 'Soy Sauce', 'cat_cond', 'Sauces', 'ml', 'litre', 1000, 1, 365, 0.118, 'sup_4', 'loc_dry', 6000, 1500],
  ['SAU-002', 'Vinegar', 'cat_cond', 'Sauces', 'ml', 'litre', 1000, 1, 365, 0.056, 'sup_4', 'loc_dry', 5000, 1200],
  ['SAU-003', 'Tomato Ketchup', 'cat_cond', 'Sauces', 'g', 'kg', 1000, 1, 180, 0.098, 'sup_4', 'loc_dry', 8000, 2000],
  ['SAU-004', 'Red Chilli Sauce', 'cat_cond', 'Sauces', 'g', 'kg', 1000, 1, 180, 0.112, 'sup_4', 'loc_dry', 5000, 1200],
  ['BEV-001', 'Tea Powder', 'cat_bev', 'Hot Beverage Base', 'g', 'kg', 1000, 1, 240, 0.42, 'sup_bev', 'loc_dry', 6000, 1500],
  ['BEV-002', 'Filter Coffee Powder', 'cat_bev', 'Hot Beverage Base', 'g', 'kg', 1000, 1, 120, 0.58, 'sup_bev', 'loc_dry', 4000, 1000],
  ['BEV-003', 'Soda (200 ml bottle)', 'cat_bev', 'Cold Beverage Base', 'unit', 'crate', 24, 1, 180, 14, 'sup_bev', 'loc_dry', 240, 72],
  ['DRY-004', 'Khoya (Mawa)', 'cat_dry', 'Dessert Mixes', 'g', 'kg', 1000, 1, 6, 0.36, 'sup_3', 'loc_cold', 5000, 1500],
  ['SPC-008', 'Chaat Masala', 'cat_spice', 'Masala Blends', 'g', 'kg', 1000, 1, 180, 0.52, 'sup_4', 'loc_dry', 3000, 800],
  ['SPC-009', 'Black Pepper Powder', 'cat_spice', 'Ground Spices', 'g', 'kg', 1000, 1, 180, 1.24, 'sup_4', 'loc_dry', 2000, 500],
  ['SPC-010', 'Green Cardamom', 'cat_spice', 'Whole Spices', 'g', 'kg', 1000, 1, 365, 3.1, 'sup_4', 'loc_dry', 1200, 300],
  ['SPC-011', 'Whole Garam Masala', 'cat_spice', 'Whole Spices', 'g', 'kg', 1000, 1, 365, 0.88, 'sup_4', 'loc_dry', 2500, 700],
  ['PKG-004', 'Beverage Cup', 'cat_pkg', 'Containers', 'unit', 'unit', 1, 1, null, 4, 'sup_6', 'loc_dry', 900, 300],
]
for (const [sku, name, c, s, bu, pu, conv, yld, shelf, cost, supp, loc, par, reorder] of EXTRA) {
  ITEMS.push({
    id: `itm_${sku.toLowerCase().replace(/[^a-z0-9]/g, '')}`, sku, name,
    categoryId: c, subCategoryId: sub[`${c}|${s}`] ?? null,
    baseUnit: bu, purchaseUnit: pu, purchaseConversion: conv, yieldPct: yld,
    shelfLifeDays: shelf, parLevel: par, reorderLevel: reorder,
    defaultSupplierId: supp === 'sup_6' ? 'sup_6' : supp, defaultLocationId: loc,
    gstPct: c === 'cat_pkg' ? 18 : 5, isPrep: false, trackBatches: shelf !== null && shelf <= 30,
    avgCost: cost, lastPurchaseCost: cost, active: true,
  })
}

/** Extra prep items produced in-house. */
const EXTRA_PREP = [
  ['PRP-004', 'Tandoori Marinade', 'Pastes', 'ml', 3],
  ['PRP-005', 'Birista (Fried Onion)', 'Garnishes', 'g', 7],
  ['PRP-006', 'Green Chutney', 'Pastes', 'g', 3],
  ['PRP-007', 'Manchurian Sauce Base', 'Gravies', 'ml', 2],
]
for (const [sku, name, s, bu, shelf] of EXTRA_PREP) {
  ITEMS.push({
    id: `itm_${sku.toLowerCase().replace(/[^a-z0-9]/g, '')}`, sku, name,
    categoryId: 'cat_prep', subCategoryId: sub[`cat_prep|${s}`] ?? null,
    baseUnit: bu, purchaseUnit: bu, purchaseConversion: 1, yieldPct: 1,
    shelfLifeDays: shelf, parLevel: 0, reorderLevel: 0, defaultSupplierId: null,
    defaultLocationId: 'loc_kitchen', gstPct: 5, isPrep: true, trackBatches: true,
    avgCost: 0, lastPurchaseCost: 0, active: true,
  })
}

const bySku = Object.fromEntries(ITEMS.map((i) => [i.sku, i.id]))
const I = (sku) => {
  if (!bySku[sku]) throw new Error(`unknown sku ${sku}`)
  return bySku[sku]
}

/* ---------------- dishes ---------------- */
const DISH_SUB = {
  'Chicken Biryani': ['mc_biryani', 'Non-Veg Biryani', 'sec_biryani'],
  'Mutton Biryani': ['mc_biryani', 'Non-Veg Biryani', 'sec_biryani'],
  'Veg Biryani': ['mc_biryani', 'Veg Biryani', 'sec_biryani'],
  'Butter Chicken': ['mc_main', 'Non-Veg Gravy', 'sec_curry'],
  'Paneer Butter Masala': ['mc_main', 'Veg Gravy', 'sec_curry'],
  'Dal Makhani': ['mc_main', 'Veg Gravy', 'sec_curry'],
  'Chicken 65': ['mc_starter', 'Non-Veg Starters', 'sec_wok'],
  'Fish Curry': ['mc_main', 'Non-Veg Gravy', 'sec_curry'],
  'Jeera Rice': ['mc_bread', 'Rice', 'sec_biryani'],
  'Butter Naan': ['mc_bread', 'Breads', 'sec_bread'],
  'Tandoori Roti': ['mc_bread', 'Breads', 'sec_bread'],
  'Gulab Jamun (2 pc)': ['mc_dessert', 'Indian Sweets', 'sec_pastry'],
}
const DISH_MAP = {}
const DISHES = src.menu.map((d, i) => {
  const id = `dsh_${String(d.id).padStart(2, '0')}`
  DISH_MAP[d.id] = id
  const [c, s, sec] = DISH_SUB[d.name] ?? ['mc_main', 'Veg Gravy', 'sec_curry']
  return {
    id, code: `M${String(i + 1).padStart(3, '0')}`, name: d.name, categoryId: c,
    subCategoryId: sub[`${c}|${s}`] ?? null, price: d.price, gstPct: 5,
    packagingCost: d.packaging_cost, otherVariableCost: d.other_var_cost,
    sectionId: sec, prepTimeMins: 12, active: true,
  }
})

const NEW_DISHES = [
  ['Paneer Tikka', 'mc_starter', 'Veg Starters', 320, 10, 8, 'sec_tandoor', 18],
  ['Chicken Tikka', 'mc_starter', 'Non-Veg Starters', 340, 10, 9, 'sec_tandoor', 20],
  ['Veg Manchurian', 'mc_starter', 'Veg Starters', 250, 10, 7, 'sec_wok', 14],
  ['Chilli Chicken', 'mc_starter', 'Non-Veg Starters', 330, 10, 9, 'sec_wok', 15],
  ['Gobi 65', 'mc_starter', 'Veg Starters', 240, 10, 7, 'sec_wok', 12],
  ['Kadai Paneer', 'mc_main', 'Veg Gravy', 340, 10, 8, 'sec_curry', 14],
  ['Chicken Chettinad', 'mc_main', 'Non-Veg Gravy', 380, 10, 10, 'sec_curry', 16],
  ['Palak Paneer', 'mc_main', 'Veg Gravy', 320, 10, 8, 'sec_curry', 13],
  ['Prawn Masala', 'mc_main', 'Non-Veg Gravy', 450, 10, 11, 'sec_curry', 16],
  ['Garlic Naan', 'mc_bread', 'Breads', 70, 3, 3, 'sec_bread', 5],
  ['Veg Pulao', 'mc_bread', 'Rice', 220, 8, 5, 'sec_biryani', 12],
  ['Gajar Halwa', 'mc_dessert', 'Indian Sweets', 140, 6, 4, 'sec_pastry', 8],
  ['Masala Chai', 'mc_bev', 'Hot', 60, 4, 2, 'sec_pastry', 4],
  ['Fresh Lime Soda', 'mc_bev', 'Cold', 90, 4, 3, 'sec_pastry', 3],
]
NEW_DISHES.forEach(([name, c, s, price, pkg, other, sec, prep], i) => {
  DISHES.push({
    id: `dsh_${String(13 + i).padStart(2, '0')}`, code: `M${String(13 + i).padStart(3, '0')}`,
    name, categoryId: c, subCategoryId: sub[`${c}|${s}`] ?? null, price, gstPct: 5,
    packagingCost: pkg, otherVariableCost: other, sectionId: sec, prepTimeMins: prep, active: true,
  })
})
const dishByName = Object.fromEntries(DISHES.map((d) => [d.name, d.id]))

/* ---------------- recipes ---------------- */
const RECIPES = []
let rid = 0
const recipe = (ownerType, ownerId, yieldQty, lines, steps, plating, prepMins) => {
  RECIPES.push({
    id: `rcp_${++rid}`, ownerType, ownerId, version: 1, yieldQty,
    lines: lines.map(([sku, qty, w], i) => ({
      id: `rl_${rid}_${i}`, itemId: I(sku), qty, wastagePct: w ?? 0, optional: false,
    })),
    steps: (steps ?? []).map((t, i) => ({
      id: `sp_${rid}_${i}`, seq: i + 1,
      instruction: typeof t === 'string' ? t : t[0],
      minutes: typeof t === 'string' ? undefined : t[1],
      ccp: typeof t === 'string' ? undefined : t[2],
    })),
    platingNotes: plating, standardPrepMins: prepMins,
    updatedAt: '2026-05-01T09:00:00.000Z', updatedBy: 'stf_head', active: true,
  })
}

// Carry over the 12 original dish recipes, mapped to the new ids.
const skuById = Object.fromEntries(src.items.map((i) => [i.id, i.sku]))
for (const [oldDishId, r] of Object.entries(srcRecipes.menu)) {
  const dishId = DISH_MAP[oldDishId]
  if (!dishId) continue
  const lines = r.lines.map((l) => [skuById[l.c], l.q, l.w])
  recipe('DISH', dishId, r.yield || 1, lines)
}
for (const [oldItemId, r] of Object.entries(srcRecipes.prep)) {
  const sku = skuById[oldItemId]
  if (!sku) continue
  const lines = r.lines.map((l) => [skuById[l.c], l.q, l.w])
  recipe('PREP', I(sku), r.yield || 1, lines)
}

fs.mkdirSync('tools/.cache', { recursive: true })
fs.writeFileSync('tools/.cache/stage1.json', JSON.stringify({
  categories: CAT, locations: LOCATIONS, sections: SECTIONS, staff: STAFF,
  suppliers: SUPPLIERS, items: ITEMS, dishes: DISHES, recipes: RECIPES,
  dishByName, bySku,
}))
console.log('stage1:', { cats: CAT.length, items: ITEMS.length, dishes: DISHES.length, recipes: RECIPES.length })
