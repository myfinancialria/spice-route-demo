/** Writes a plausible supplier invoice PDF, for testing the bill reader. */
import { mkdirSync, writeFileSync } from 'node:fs'

const FRAGMENTS = []
const put = (x, y, s, size = 9) => FRAGMENTS.push({ x, y, s, size })

put(40, 800, 'AL-BARKAT MEATS', 15)
put(40, 784, '12, Shivajinagar Market, Bengaluru 560051')
put(40, 771, 'GSTIN: 29ABCDE1000F1Z0   Phone: 98450 11221')
put(400, 800, 'TAX INVOICE', 13)
put(400, 782, 'Invoice No: AB/4821')
put(400, 769, 'Date: 12/09/2026')
put(400, 756, 'Place of Supply: Karnataka')

put(40, 726, 'Bill To: Spice Route Kitchen, Indiranagar, Bengaluru')

let y = 700
put(40, y, 'Sl'); put(66, y, 'Description'); put(300, y, 'HSN'); put(350, y, 'Qty')
put(400, y, 'UOM'); put(440, y, 'Rate'); put(510, y, 'Amount')

const rows = [
  ['1', 'CHICKEN CURRY CUT FRESH', '02071200', '62.500', 'KGS', '318.00', '19875.00'],
  ['2', 'MUTTON CURRY CUT (BONE IN)', '02041000', '11.250', 'KGS', '1015.00', '11418.75'],
  ['3', 'CHICKEN BONELESS BREAST', '02071200', '8.000', 'KGS', '392.00', '3136.00'],
]
for (const r of rows) {
  y -= 20
  put(40, y, r[0]); put(66, y, r[1]); put(300, y, r[2]); put(350, y, r[3])
  put(400, y, r[4]); put(440, y, r[5]); put(510, y, r[6])
}

y -= 34
put(400, y, 'Taxable Value'); put(510, y, '34429.75')
y -= 15
put(400, y, 'CGST 2.5%'); put(510, y, '860.74')
y -= 15
put(400, y, 'SGST 2.5%'); put(510, y, '860.74')
y -= 18
put(400, y, 'Grand Total', 11); put(505, y, '36151.23', 11)
y -= 30
put(40, y, 'Amount in words: Thirty Six Thousand One Hundred Fifty One Only')
y -= 14
put(40, y, 'Terms: Net 7 days. Goods once sold will not be taken back.')
y -= 30
put(400, y, 'For AL-BARKAT MEATS')

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
const content = FRAGMENTS
  .map((f) => `BT /F1 ${f.size} Tf 1 0 0 1 ${f.x} ${f.y} Tm (${esc(f.s)}) Tj ET`)
  .join('\n')

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
]

let pdf = '%PDF-1.4\n'
const offsets = []
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(pdf))
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
})
const xrefAt = Buffer.byteLength(pdf)
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`

const out = process.argv[2] ?? 'tools/.cache/al-barkat-4821.pdf'
mkdirSync('tools/.cache', { recursive: true })
writeFileSync(out, pdf, 'latin1')
console.log('wrote', out, Buffer.byteLength(pdf), 'bytes')
