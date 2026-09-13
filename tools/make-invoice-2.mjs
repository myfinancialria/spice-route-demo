/** A second, deliberately awkward invoice: different column order, mixed units. */
import { mkdirSync, writeFileSync } from 'node:fs'
const F = []
const put = (x, y, s, size = 9) => F.push({ x, y, s, size })

put(40, 800, 'Sri Lakshmi Vegetables', 14)
put(40, 785, 'Russell Market, Bengaluru | GSTIN 29ABCDE3000F1Z2')
put(400, 800, 'Bill No : SLV-2291')
put(400, 786, 'Dt : 13-09-2026')

let y = 745
put(40, y, 'Particulars'); put(250, y, 'Amount'); put(330, y, 'Rate'); put(400, y, 'Qty'); put(450, y, 'Unit')
const rows = [
  ['Onion Nasik', '2856.00', '34.00', '84.000', 'Kgs'],
  ['Tomato Hybrid', '1140.00', '38.00', '30.000', 'Kgs'],
  ['Coriander Leaves', '660.00', '55.00', '12.000', 'Kgs'],
  ['Ginger', '1425.00', '95.00', '15.000', 'Kgs'],
  ['Green Chilli Long', '576.00', '48.00', '12.000', 'Kgs'],
  ['Lemon Big', '900.00', '6.00', '150.000', 'Nos'],
  ['Potato', '1240.00', '31.00', '40.000', 'Kgs'],
]
for (const r of rows) {
  y -= 19
  put(40, y, r[0]); put(250, y, r[1]); put(330, y, r[2]); put(400, y, r[3]); put(450, y, r[4])
}
y -= 30
put(330, y, 'Net Payable'); put(450, y, '8797.00', 11)
y -= 26
put(40, y, 'Payment within 3 days. Contact 98450 33445')

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
const content = F.map((f) => `BT /F1 ${f.size} Tf 1 0 0 1 ${f.x} ${f.y} Tm (${esc(f.s)}) Tj ET`).join('\n')
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
]
let pdf = '%PDF-1.4\n'; const offs = []
objects.forEach((b, i) => { offs.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${b}\nendobj\n` })
const xref = Buffer.byteLength(pdf)
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
for (const o of offs) pdf += `${String(o).padStart(10, '0')} 00000 n \n`
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
mkdirSync('tools/.cache', { recursive: true })
writeFileSync(process.argv[2] ?? 'tools/.cache/slv-2291.pdf', pdf, 'latin1')
console.log('wrote second invoice')
