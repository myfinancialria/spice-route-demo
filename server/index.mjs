/**
 * Kitchen Ledger server.
 *
 * The browser app is local-first and needs none of this. Run the server when
 * several devices must share one set of books: the same domain code that runs
 * in the browser runs here, against SQLite instead of IndexedDB, so a command
 * posted from a phone produces byte-for-byte the same ledger movements.
 *
 *   npm run server              # http://localhost:5190
 *   VITE_API_BASE=http://localhost:5190/api npm run build
 */
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  buildContext, generateSeed, iso, postBill, postIssue, postProduction,
  postSales, postStocktake, postWastage, reverseDocument,
} from './lib/core.mjs'

const PORT = Number(process.env.PORT ?? 5190)
const DB_PATH = process.env.DB_PATH ?? resolve('server/data/ledger.db')

const COLLECTIONS = [
  'categories', 'sections', 'locations', 'staff', 'suppliers', 'items', 'dishes',
  'recipes', 'bills', 'issues', 'production', 'wastage', 'sales', 'stocktakes',
  'dayCloses', 'movements',
]

mkdirSync(dirname(DB_PATH), { recursive: true })
const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
for (const name of COLLECTIONS) {
  db.exec(`CREATE TABLE IF NOT EXISTS "${name}" (id TEXT PRIMARY KEY, json TEXT NOT NULL)`)
}
db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

/* ---------------- storage helpers ---------------- */

const readAll = (name) =>
  db.prepare(`SELECT json FROM "${name}"`).all().map((r) => JSON.parse(r.json))

const upsert = db.prepare.bind(db)
function putMany(name, records) {
  if (!records?.length) return 0
  const stmt = upsert(`INSERT INTO "${name}" (id, json) VALUES (?, ?)
                       ON CONFLICT(id) DO UPDATE SET json = excluded.json`)
  db.exec('BEGIN')
  try {
    for (const r of records) stmt.run(r.id, JSON.stringify(r))
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return records.length
}

function loadState() {
  const out = {}
  for (const name of COLLECTIONS) out[name] = readAll(name)
  return out
}

function isSeeded() {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('seededAt')
  return !!row
}

function seed() {
  const data = generateSeed(iso(new Date()))
  db.exec('BEGIN')
  try {
    for (const name of COLLECTIONS) {
      db.exec(`DELETE FROM "${name}"`)
      const stmt = db.prepare(`INSERT INTO "${name}" (id, json) VALUES (?, ?)`)
      for (const r of data[name] ?? []) stmt.run(r.id, JSON.stringify(r))
    }
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('seededAt', new Date().toISOString())
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return data
}

/* ---------------- command execution ---------------- */

/**
 * Balances are summed from the movement table on demand. A restaurant's ledger
 * is tens of thousands of rows, not millions, so this stays well inside a
 * millisecond and avoids a cached balance that can silently drift out of step.
 */
function makePostContext() {
  const items = readAll('items')
  const recipes = readAll('recipes')
  const balanceRows = db.prepare(
    'SELECT json FROM "movements"',
  ).all().map((r) => JSON.parse(r.json))
  const bal = new Map()
  for (const m of balanceRows) {
    const key = `${m.itemId}|${m.locationId}`
    bal.set(key, (bal.get(key) ?? 0) + m.qty)
  }
  return {
    items,
    ctx: buildContext(items, recipes),
    balance: (itemId, locationId) => bal.get(`${itemId}|${locationId}`) ?? 0,
  }
}

const COMMANDS = {
  bill: { fn: postBill, collection: 'bills' },
  issue: { fn: postIssue, collection: 'issues' },
  production: { fn: postProduction, collection: 'production' },
  wastage: { fn: postWastage, collection: 'wastage' },
  sales: { fn: postSales, collection: 'sales' },
  stocktake: { fn: postStocktake, collection: 'stocktakes' },
}

function runCommand(name, document) {
  const command = COMMANDS[name]
  if (!command) throw Object.assign(new Error(`Unknown command "${name}"`), { status: 404 })
  const pc = makePostContext()
  const result = command.fn(pc, document)
  putMany(command.collection, [document])
  putMany('movements', result.movements)
  putMany('items', result.itemPatches)
  return result
}

/* ---------------- http ---------------- */

const json = (res, status, body) => {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  })
  res.end(payload)
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return null
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {})

  const url = new URL(req.url, `http://${req.headers.host}`)
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)

  try {
    if (!url.pathname.startsWith('/api')) {
      return json(res, 404, { error: 'The API is served under /api' })
    }

    // GET /api/health
    if (parts[0] === 'health') {
      return json(res, 200, {
        ok: true, seeded: isSeeded(), db: DB_PATH,
        counts: Object.fromEntries(COLLECTIONS.map((c) => [
          c, db.prepare(`SELECT COUNT(*) AS n FROM "${c}"`).get().n,
        ])),
      })
    }

    // GET /api/state — everything the client needs to boot
    if (parts[0] === 'state' && req.method === 'GET') {
      if (!isSeeded()) seed()
      return json(res, 200, loadState())
    }

    // POST /api/seed — regenerate the demo data
    if (parts[0] === 'seed' && req.method === 'POST') {
      seed()
      return json(res, 200, { ok: true, ...loadState() })
    }

    // POST /api/restore — replace everything from a client backup
    if (parts[0] === 'restore' && req.method === 'POST') {
      const body = await readBody(req)
      const data = body?.data ?? body
      db.exec('BEGIN')
      try {
        for (const name of COLLECTIONS) {
          db.exec(`DELETE FROM "${name}"`)
          const stmt = db.prepare(`INSERT INTO "${name}" (id, json) VALUES (?, ?)`)
          for (const r of data[name] ?? []) stmt.run(r.id, JSON.stringify(r))
        }
        db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
          .run('seededAt', new Date().toISOString())
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
      return json(res, 200, { ok: true })
    }

    // POST /api/commands/:name — post a document through the domain logic
    if (parts[0] === 'commands' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body) return json(res, 400, { error: 'A document is required' })
      const result = runCommand(parts[1], body)
      return json(res, 200, result)
    }

    // POST /api/void — reverse everything a document created
    if (parts[0] === 'void' && req.method === 'POST') {
      const body = await readBody(req)
      const movements = readAll('movements')
      const reversals = reverseDocument(movements, body.refType, body.refId)
      putMany('movements', reversals)
      return json(res, 200, { movements: reversals, itemPatches: [], warnings: [] })
    }

    // Collection CRUD
    const [collection, id] = parts
    if (!COLLECTIONS.includes(collection)) {
      return json(res, 404, { error: `Unknown collection "${collection}"` })
    }
    if (req.method === 'GET') {
      return json(res, 200, id
        ? JSON.parse(db.prepare(`SELECT json FROM "${collection}" WHERE id = ?`).get(id)?.json ?? 'null')
        : readAll(collection))
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const body = await readBody(req)
      const records = Array.isArray(body) ? body : [body]
      const n = putMany(collection, records)
      return json(res, 200, { ok: true, written: n })
    }
    if (req.method === 'DELETE' && id) {
      db.prepare(`DELETE FROM "${collection}" WHERE id = ?`).run(id)
      return json(res, 200, { ok: true })
    }
    return json(res, 405, { error: `${req.method} not allowed here` })
  } catch (err) {
    console.error(err)
    return json(res, err.status ?? 500, { error: err.message ?? 'Server error' })
  }
})

server.listen(PORT, () => {
  console.log(`Kitchen Ledger API on http://localhost:${PORT}/api`)
  console.log(`SQLite at ${DB_PATH}`)
  if (!isSeeded()) console.log('Database is empty — GET /api/state will seed it on first call.')
})
