/**
 * Invoice text → line items.
 *
 * Deliberately free of any PDF dependency: this takes the text lines a
 * document reader produced and works out what the restaurant actually bought.
 * Keeping it separate means it can be tested against real invoice wording
 * without a PDF anywhere in sight.
 */
import type { Item, PurchaseUnit, Supplier } from '../core/types'

export interface ParsedLine {
  raw: string
  description: string
  qty: number | null
  unit: PurchaseUnit | null
  rate: number | null
  amount: number | null
  itemId: string | null
  confidence: number
}

export interface ParsedBill {
  supplierId: string | null
  supplierGuess: string | null
  billNo: string | null
  billDate: string | null
  total: number | null
  lines: ParsedLine[]
  text: string
  pages: number
}

const UNIT_WORDS: Record<string, PurchaseUnit> = {
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g',
  l: 'litre', ltr: 'litre', ltrs: 'litre', lt: 'litre', litre: 'litre', litres: 'litre', liter: 'litre',
  ml: 'ml', mls: 'ml',
  pc: 'unit', pcs: 'unit', piece: 'unit', pieces: 'unit', nos: 'unit', no: 'unit',
  unit: 'unit', units: 'unit', ea: 'unit',
  pkt: 'packet', pkts: 'packet', packet: 'packet', packets: 'packet', pack: 'packet',
  box: 'box', boxes: 'box', carton: 'box', cartons: 'box',
  tray: 'tray', trays: 'tray', crate: 'crate', crates: 'crate',
  bunch: 'bunch', bunches: 'bunch', dozen: 'dozen', dz: 'dozen',
}

const UNIT_PATTERN = /\b(kgs?|kilos?|gms?|grams?|ltrs?|litres?|liters?|ml|pcs?|pieces?|nos?|pkts?|packets?|boxes|box|trays?|crates?|bunch(?:es)?|dozen|dz|units?|ea)\b/i

const NUMBER = String.raw`(-?[\d,]+(?:\.\d+)?)`

const SKIP_PREFIX = /^(s\.?\s?no\b|sr\b|sl\b|description|particulars|item\s|hsn|total|sub\s*total|grand|cgst|sgst|igst|gst\b|tax\b|amount in words|terms|bank|signature|e\.?&?o\.?e|for\s|bill to|ship to|place of supply)/i

/**
 * Header and footer lines carry numbers that look exactly like a line item —
 * a GSTIN, a phone number, a date — and will happily parse into a bogus
 * purchase of twelve units at nine rupees if they are not thrown out first.
 */
const SKIP_CONTAINS = /(gstin|gst\s*no|phone|mobile|tel\b|contact|e-?mail|pan\b|state\s*code|invoice\s*no|bill\s*no|date\s*:|ifsc|account\s*no|fssai|payment|remarks?|delivery\s*(note|by)|vehicle|driver|received\s*by|thank|words)/i
const DATE_LIKE = /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/

export function normalise(s: string): string {
  return s.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Like `normalise`, but keeps what is inside brackets. "Chicken (curry cut)"
 * must stay three words: reduced to "chicken" it matches every chicken product
 * on every invoice, including boneless breast that the kitchen never buys.
 */
export function normaliseName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

const STOP = new Set(['fresh', 'the', 'and', 'with', 'for', 'per', 'pack', 'packed', 'grade'])

function tokensOf(s: string): string[] {
  return normaliseName(s).split(' ').filter((t) => t.length > 2 && !STOP.has(t))
}

/**
 * Split one candidate row into a description and its numeric columns.
 *
 * Invoices put quantity, rate and amount in some order at the end of the line.
 * Where three numbers are present, the one that makes qty × rate = amount true
 * decides the order; guessing by position alone gets it wrong often enough to
 * matter when a rate lands in the quantity column.
 */
export function parseRow(line: string): Omit<ParsedLine, 'itemId' | 'confidence'> | null {
  const cleaned = line.replace(/₹|Rs\.?/gi, ' ').replace(/\s+/g, ' ').trim()
  if (cleaned.length < 4) return null
  if (SKIP_PREFIX.test(cleaned) || SKIP_CONTAINS.test(cleaned) || DATE_LIKE.test(cleaned)) return null

  const nums = [...cleaned.matchAll(new RegExp(NUMBER, 'g'))]
  if (nums.length < 2) return null

  // Numeric columns start at the first of the trailing run of numbers.
  const startIdx = nums.length >= 3 ? nums.length - 3 : 0
  const descEnd = cleaned.indexOf(nums[startIdx][0], 0)
  let description = cleaned.slice(0, descEnd).trim()
  description = description
    .replace(/^\d{1,3}\s*[.)]\s*/, '')
    .replace(/^\d{1,3}\s+(?=[A-Za-z])/, '')
    .replace(/\b\d{6,8}\b/g, '')
    .replace(UNIT_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (description.length < 2) return null

  const values = nums.map((m) => Number(m[1].replace(/,/g, ''))).filter(Number.isFinite)
  const tail = values.slice(-3)

  let qty: number | null = null
  let rate: number | null = null
  let amount: number | null = null

  if (tail.length >= 3) {
    const [a, b, c] = tail
    const fits = (q: number, r: number, amt: number) => Math.abs(q * r - amt) <= Math.max(1, Math.abs(amt) * 0.06)
    if (fits(a, b, c)) { qty = a; rate = b; amount = c }
    else if (fits(a, c, b)) { qty = a; rate = c; amount = b }
    else if (fits(c, b, a)) { qty = c; rate = b; amount = a }
    else { qty = a; rate = b; amount = c }
  } else if (tail.length === 2) {
    qty = tail[0]
    rate = tail[1]
    amount = qty * rate
  }

  const unitMatch = cleaned.match(UNIT_PATTERN)
  const unit = unitMatch ? UNIT_WORDS[unitMatch[1].toLowerCase()] ?? null : null

  return { raw: line, description, qty, unit, rate, amount }
}

/**
 * Match a supplier's wording to an item.
 *
 * Suppliers write "CHICKEN CURRY CUT FRESH" where the master says
 * "Chicken (curry cut)", so this scores shared words rather than looking for
 * an exact string, and remembers every correction a human makes.
 */
export function matchItem(
  description: string,
  items: Item[],
  aliases: Record<string, string>,
): { itemId: string | null; confidence: number } {
  const key = normalise(description)
  if (!key) return { itemId: null, confidence: 0 }
  if (aliases[key]) return { itemId: aliases[key], confidence: 1 }

  const descTokens = tokensOf(description)
  if (!descTokens.length) return { itemId: null, confidence: 0 }
  const descSet = new Set(descTokens)

  let best: { id: string; score: number } | null = null
  for (const item of items) {
    if (!item.active || item.isPrep) continue
    if (normalise(item.sku) === key) return { itemId: item.id, confidence: 1 }
    const nameTokens = tokensOf(item.name)
    if (!nameTokens.length) continue

    let hits = 0
    for (const t of nameTokens) {
      if (descSet.has(t)) { hits += 1; continue }
      for (const q of descSet) {
        if (q.startsWith(t) || t.startsWith(q)) { hits += 0.7; break }
      }
    }
    /*
     * Overlap measured against BOTH names, not just the master's.
     * "Chicken boneless breast" shares one word with "Chicken curry cut";
     * scoring only against the master would call that a perfect match and
     * silently book the wrong item.
     */
    const score = (2 * hits) / (nameTokens.length + descTokens.length)
    if (!best || score > best.score) best = { id: item.id, score }
  }
  if (best && best.score >= 0.55) return { itemId: best.id, confidence: Math.min(best.score, 0.95) }
  return { itemId: null, confidence: best?.score ?? 0 }
}

export function findDate(text: string): string | null {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  if (iso) return iso[0]
  const m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/)
  if (!m) return null
  const [, d, mo, y] = m
  const year = y.length === 2 ? `20${y}` : y
  return `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}

export function findBillNo(text: string): string | null {
  // Prefer an explicit "Invoice No" label. Matching the bare word "invoice"
  // first would pick up the "TAX INVOICE" heading and return a fragment of it.
  const labelled = text.match(/\b(?:invoice|bill|inv)\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9/\-]{2,23})/i)
  if (labelled) return labelled[1]
  const loose = text.match(/\b(?:invoice|bill)\b\s*[:#\-]\s*([A-Za-z0-9][A-Za-z0-9/\-]{2,23})/i)
  return loose ? loose[1] : null
}

export function findTotal(text: string): number | null {
  const m = text.match(/(?:grand\s*total|total\s*amount|net\s*payable|total)\s*[:\-]?\s*₹?\s*([\d,]+(?:\.\d+)?)/i)
  return m ? Number(m[1].replace(/,/g, '')) : null
}

/** Turn the text lines of an invoice into a reviewable draft bill. */
export function parseInvoiceText(
  lines: string[],
  items: Item[],
  suppliers: Supplier[],
  aliases: Record<string, string>,
  pages = 1,
): ParsedBill {
  const text = lines.join('\n')
  // "Al-Barkat Meats" arrives as "AL-BARKAT MEATS"; matching on the first word
  // alone fails on any name that starts with a short one.
  const haystack = new Set(normaliseName(text).split(' '))
  let supplier: Supplier | null = null
  let bestSupplier = 0
  for (const s of suppliers) {
    const words = tokensOf(s.name)
    if (!words.length) continue
    const hits = words.filter((w) => haystack.has(w)).length
    const score = hits / words.length
    if (score > bestSupplier && score >= 0.5) { bestSupplier = score; supplier = s }
  }

  const parsed: ParsedLine[] = []
  for (const line of lines) {
    const row = parseRow(line)
    if (!row || !row.qty || row.qty <= 0) continue
    const { itemId, confidence } = matchItem(row.description, items, aliases)
    parsed.push({ ...row, itemId, confidence })
  }

  return {
    supplierId: supplier?.id ?? null,
    supplierGuess: supplier?.name ?? null,
    billNo: findBillNo(text),
    billDate: findDate(text),
    total: findTotal(text),
    lines: parsed,
    text,
    pages,
  }
}

/* ---------------- alias memory ---------------- */

const ALIAS_KEY = 'kl.billAliases'

export function loadAliases(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(ALIAS_KEY) ?? '{}') } catch { return {} }
}

/** Remember a correction so the same supplier wording matches next month. */
export function rememberAlias(description: string, itemId: string): void {
  try {
    const all = loadAliases()
    all[normalise(description)] = itemId
    localStorage.setItem(ALIAS_KEY, JSON.stringify(all))
  } catch { /* storage blocked */ }
}
