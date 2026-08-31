# Restaurant Inventory Intelligence — live demo

A read-only demo of a restaurant inventory and profit-intelligence platform,
built for **Spice Route Kitchen** (a fictional restaurant used for demonstration).

**→ https://myfinancialria.github.io/spice-route-demo/**

Four months of trading history — 2026-05-03 to 2026-08-31, 13,116 stock
movements, 17 stocktakes — so trends can actually be read rather than guessed at.

### What to look at

| Screen | What it shows |
|---|---|
| **Control Tower** | Today's position, ranked actions, and the monthly profit-leakage estimate |
| **P&L / Leakage** | Month-on-month food cost — it drifts 27.4% → 29.8% over the four months |
| **Variance** | Actual vs theoretical consumption; chicken runs ~6% over recipe |
| **Menu & Costing** | Live plate cost, and a chicken price rise traced through to every dish |
| **Expiry & FEFO** | Only stock that genuinely cannot be used in time is flagged |

This build is static: every figure was produced by the real engine and baked to
JSON, so there is no server to keep awake and nothing can be edited.
