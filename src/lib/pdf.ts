/**
 * PDF reader.
 *
 * Rebuilds visual text lines from a PDF's positioned fragments and hands them
 * to the invoice parser. Everything that decides what a line *means* lives in
 * billParse.ts; this file only turns a file into strings.
 */
import type { Item, Supplier } from '../core/types'
import { type ParsedBill, parseInvoiceText } from './billParse'

/**
 * pdf.js and its worker are over a megabyte between them. Load them the first
 * time someone actually drops an invoice in, not on every visit to a purchase
 * screen.
 */
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null

function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjs, worker] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ])
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    })()
  }
  return pdfjsPromise
}

/**
 * A PDF emits text fragments in whatever order it likes, each with a position.
 * Grouping by y and sorting by x reconstructs the rows a human sees, which is
 * the only form the line parser can work with.
 */
export async function extractLines(file: File | ArrayBuffer): Promise<{ lines: string[]; pages: number }> {
  const pdfjs = await loadPdfjs()
  const data = file instanceof ArrayBuffer ? file : await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data }).promise
  const pages = doc.numPages
  const all: string[] = []

  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const rows = new Map<number, { x: number; s: string }[]>()
    for (const raw of content.items as { str: string; transform: number[] }[]) {
      if (!raw.str.trim()) continue
      const y = Math.round(raw.transform[5])
      // Characters on the same visual line rarely share an exact y.
      const bucket = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y
      const list = rows.get(bucket) ?? []
      list.push({ x: raw.transform[4], s: raw.str })
      rows.set(bucket, list)
    }
    for (const [, frags] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
      all.push(frags.sort((a, b) => a.x - b.x).map((f) => f.s).join(' ').replace(/\s+/g, ' ').trim())
    }
  }
  await doc.destroy()
  return { lines: all.filter(Boolean), pages }
}

export async function parseBill(
  file: File, items: Item[], suppliers: Supplier[], aliases: Record<string, string>,
): Promise<ParsedBill> {
  const { lines, pages } = await extractLines(file)
  return parseInvoiceText(lines, items, suppliers, aliases, pages)
}

export { loadAliases, rememberAlias, normalise } from './billParse'
export type { ParsedBill, ParsedLine } from './billParse'
