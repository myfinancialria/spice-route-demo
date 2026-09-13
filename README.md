# Kitchen Ledger

A working restaurant operations system: recipe SOPs, purchase capture, store-to-kitchen
issuing, sales depletion, end-of-day variance and chef profitability.

**→ https://myfinancialria.github.io/spice-route-demo/**

Everything is editable. The demo opens with four months of trading for a fictional
restaurant (Spice Route Kitchen, Bengaluru) so the reports have something to say on the
first click, but every screen writes back, and the data lives in your own browser.

---

## The idea

Every restaurant loses money in the gap between what the recipes say should have been
used and what actually left the shelf. That gap is invisible day to day and only shows
up when someone physically counts. This system closes the loop:

```
  SOP ──► what a dish should cost and consume
   │
   ▼
  Purchase bill ──► stock into the store, weighted-average cost updated
   │
   ▼
  Issue ──► store to kitchen, recorded in two taps
   │
   ▼
  Sales ──► recipes explode and deplete kitchen stock
   │
   ▼
  Physical count ──► expected vs actual = variance, priced and ranked
   │
   ▼
  Reports ──► against last week, against average, and by chef
```

Nothing changes a stock balance directly. Bills, issues, prep batches, sales, wastage and
counts all write rows to one append-only ledger, and every balance is the sum of them —
so any figure on any screen can be traced back to the document that caused it.

## What is in it

| Area | Screens |
|---|---|
| **SOP & Menu** | Recipe SOPs (quantities, method, control points), Prep & sub-recipes, Menu dishes, Plate costing, Menu engineering |
| **Purchases** | Upload bill (PDF), Manual entry for handwritten bills, Purchase register, Price watch, Suppliers |
| **Store** | Goods receipt, Store stock, Issue to kitchen, Store stocktake |
| **Kitchen** | Quick Take, Prep production, Kitchen stock, Wastage & staff meals, Kitchen stocktake |
| **Sales** | Daily entry, POS import, Sales register, Dish performance |
| **Day Close** | Five-step close, Variance review, Close history |
| **Reports** | Food cost & P&L, Variance, Chef efficiency, Trends vs average, Item movement, Wastage, Stock valuation |
| **Setup** | Items, Categories, Locations & sections, Staff & roles, Data & backup |

Every list drills into the row behind it, and every ingredient opens a panel showing where
it is, what it has cost over time, which dishes consume it, and every movement in its history.

### A few things worth looking at

- **Recipe SOPs** — a dish's cost recalculates as you type, including ingredients hidden
  inside a gravy. The panel tells you what the dish would need to sell at to hit a 33%
  food cost.
- **Upload bill (PDF)** — reads line items straight off a supplier invoice, works out the
  column order from the arithmetic, matches descriptions to your items, and remembers every
  correction so the same supplier's next invoice matches on its own.
- **Quick Take** — the highest-frequency screen. Tiles are ordered by what the kitchen
  actually draws, quantities default to the usual amount, and entry is in the unit a chef
  would say out loud.
- **Variance review** — expected against counted, with each item's *usual* variance
  alongside. A line that is always 3% over is a recipe to fix; one that jumps to 12% is an
  incident to investigate.
- **Chef efficiency** — each chef's own P&L. Revenue from their station, recipe cost,
  leakage attributed by what their dishes actually consume, wastage, and what is left after
  their labour.

## Running it

```bash
npm install
npm run dev          # http://localhost:5180
```

The app is local-first: it generates its demo history on first load and stores everything
in IndexedDB. It works offline, which is the point — a phone in a kitchen with no signal
behaves exactly like the manager's laptop.

### Multi-device

Run the bundled server when several devices need to share one set of books:

```bash
npm run server                                   # http://localhost:5190/api
VITE_API_BASE=http://localhost:5190/api npm run dev
```

The server is Node plus `node:sqlite` — no native modules, no dependencies. It imports the
*same* domain code the browser runs, so a command posted from a phone produces byte-for-byte
the same ledger movements it would have produced locally.

### Publishing

```bash
npm run deploy:pages    # builds into docs/, which GitHub Pages serves
```

### Checking it

```bash
npm run test:seed    # generates four months of trading and reconciles it end to end
npm run test:bill    # writes two differently-shaped invoice PDFs and reads them back
npm run typecheck
```

`test:seed` is the useful one. It prints the monthly P&L, the variance from the latest
physical count and the chef scorecards, and asserts there are no negative stock balances
anywhere in the ledger — which is the quickest way to tell whether a change to the costing
or the ledger has broken the arithmetic.

The seed masters are rebuilt with `npm run seed:build`, which regenerates
`src/core/seed/masters.json` from the tables in `tools/`.

## How it is put together

```
src/core/          Pure domain logic — no I/O, no React
  types.ts         The whole model
  units.ts         Base-unit conversion, purchase units, display
  costing.ts       Recursive recipe explosion through prep items
  stock.ts         Ledger balances, weighted average cost, reorder
  variance.ts      Expected vs counted, severity, deviation from normal
  analytics.ts     Menu engineering, chef P&L, period P&L
  attribution.ts   Spreading leakage across the sections that caused it
  seed/            Deterministic four-month trading generator

src/data/          Persistence and commands
  commands.ts      The only code that writes to the ledger
  db.ts            IndexedDB
  remote.ts        HTTP backend (optional)
  store.tsx        React state, derived indexes, actions

src/lib/
  billParse.ts     Invoice text → line items (no PDF dependency)
  pdf.ts           PDF → text lines, lazily loading pdf.js

server/            Node + SQLite, sharing src/core and src/data/commands
```

### Decisions worth knowing about

**Costs are historical.** Every movement stores the rate that applied on the day it
happened, and period reports read those rates rather than re-pricing at today's. Re-costing
four months of history at today's chicken price would hide the very drift the report exists
to show — in the demo data, food cost drifts from 32.0% to 34.8% over the period, and that
is visible only because of this.

**Yield is opt-in per recipe line.** An ingredient's usable yield (peel, bone, trim) is only
applied where a line says its quantity is the edible weight. Kitchens normally weigh what
they pull out of the fridge, and counting both the stated quantity and the trim would charge
the trim twice.

**Prep items are stock, not a formula.** A sale deducts the gravy, not the onions that went
into it three days ago. Production converts raw into prep as a real movement, so the onions
are not counted twice.

**Variance is measured against throughput**, not closing stock. Closing stock on a fast
mover is near zero, which would make every rounding error look catastrophic.

**Blind counting is the default.** The system quantity stays hidden until a count is typed.
A count that can be copied will be copied, and a copied count makes the whole report worthless.

## Data

Everything lives in your browser. **Setup → Data & Backup** exports the lot as a single JSON
file, restores from one, rebuilds the demo, or erases everything so you can set up a real
restaurant from scratch.
