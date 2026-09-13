import { readFileSync } from 'node:fs'
import { parseInvoiceText } from '../src/lib/billParse'
import masters from '../src/core/seed/masters.json'
import type { Item, Supplier } from '../src/core/types'

const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')

const items = masters.items as unknown as Item[]
const suppliers = masters.suppliers as unknown as Supplier[]

const buf = new Uint8Array(readFileSync(process.argv[2] ?? 'tools/.cache/al-barkat-4821.pdf'))
const doc = await pdfjs.getDocument({ data: buf, useSystemFonts: true }).promise

const all: string[] = []
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p)
  const content = await page.getTextContent()
  const rows = new Map<number, { x: number; s: string }[]>()
  for (const raw of content.items as { str: string; transform: number[] }[]) {
    if (!raw.str.trim()) continue
    const y = Math.round(raw.transform[5])
    const bucket = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y
    const list = rows.get(bucket) ?? []
    list.push({ x: raw.transform[4], s: raw.str })
    rows.set(bucket, list)
  }
  for (const [, frags] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
    all.push(frags.sort((a, b) => a.x - b.x).map((f) => f.s).join(' ').replace(/\s+/g, ' ').trim())
  }
}

console.log('--- reconstructed lines ---')
all.filter(Boolean).forEach((l) => console.log('  |', l))

const bill = parseInvoiceText(all.filter(Boolean), items, suppliers, {})
console.log('\n--- parsed header ---')
console.log({ supplier: bill.supplierGuess, billNo: bill.billNo, billDate: bill.billDate, total: bill.total })
console.log('\n--- parsed lines ---')
for (const l of bill.lines) {
  const item = items.find((i) => i.id === l.itemId)
  console.log(`  ${(item?.name ?? 'UNMATCHED').padEnd(24)} qty=${l.qty} ${l.unit ?? '?'} rate=${l.rate} amount=${l.amount} conf=${(l.confidence * 100).toFixed(0)}%  <- "${l.description}"`)
}
