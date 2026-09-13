import type { CostedLine, Dish, DishCosting, ID, Item, Recipe } from './types'
import { round } from './units'

export interface CostingContext {
  items: Map<ID, Item>
  /** Recipes keyed by `${ownerType}:${ownerId}`. */
  recipes: Map<string, Recipe>
}

export function recipeKey(ownerType: 'DISH' | 'PREP', ownerId: ID): string {
  return `${ownerType}:${ownerId}`
}

export function buildContext(items: Item[], recipes: Recipe[]): CostingContext {
  return {
    items: new Map(items.map((i) => [i.id, i])),
    recipes: new Map(recipes.filter((r) => r.active).map((r) => [recipeKey(r.ownerType, r.ownerId), r])),
  }
}

/**
 * Gross quantity that must leave the shelf to end up with `netQty` in the pan.
 *
 * Two different losses can stack here and they are easy to confuse:
 *   yieldPct   — inherent to the ingredient (peel, bone, trim). 1 kg of onion
 *                bought gives 850 g usable. Applied ONLY when the recipe line
 *                is written on an edible-portion basis, because a kitchen
 *                normally weighs what it pulls out of the fridge, not what
 *                survives the knife — counting both would charge the trim twice.
 *   wastagePct — specific to this preparation. Always applied.
 */
export function grossQty(
  item: Item | undefined,
  netQty: number,
  wastagePct: number,
  netBasis = false,
): number {
  const yieldPct = netBasis && item && item.yieldPct > 0 ? item.yieldPct : 1
  return (netQty / yieldPct) * (1 + (wastagePct || 0))
}

/**
 * Explode a recipe into costed ingredient lines, recursing through prep items
 * so a dish that uses a gravy that uses a paste is costed all the way down.
 *
 * `explode: true` flattens prep into raw ingredients (true cost origin);
 * `explode: false` keeps the prep item as one line (what the chef sees).
 */
export function costRecipe(
  ctx: CostingContext,
  ownerType: 'DISH' | 'PREP',
  ownerId: ID,
  portions = 1,
  opts: { explode?: boolean; depth?: number; seen?: Set<string> } = {},
): CostedLine[] {
  const { explode = false, depth = 0, seen = new Set<string>() } = opts
  const key = recipeKey(ownerType, ownerId)
  // Recipes can legitimately share components; a cycle cannot be costed.
  if (seen.has(key) || depth > 6) return []
  const recipe = ctx.recipes.get(key)
  if (!recipe) return []

  const nextSeen = new Set(seen).add(key)
  const perPortion = recipe.yieldQty > 0 ? portions / recipe.yieldQty : portions
  const out: CostedLine[] = []

  for (const line of recipe.lines) {
    if (line.optional) continue
    const item = ctx.items.get(line.itemId)
    if (!item) continue
    const netQty = line.qty * perPortion
    const qty = grossQty(item, netQty, line.wastagePct, line.netBasis)

    if (item.isPrep && explode) {
      const sub = costRecipe(ctx, 'PREP', item.id, qty, { explode, depth: depth + 1, seen: nextSeen })
      if (sub.length) { out.push(...sub); continue }
      // No recipe behind the prep item — fall through and cost it as stock.
    }

    const unitCost = item.isPrep && !explode ? prepUnitCost(ctx, item, nextSeen, depth) : item.avgCost
    out.push({
      itemId: item.id,
      name: item.name,
      sku: item.sku,
      baseUnit: item.baseUnit,
      qty: round(qty, 3),
      netQty: round(netQty, 3),
      unitCost,
      cost: round(qty * unitCost, 4),
      isPrep: item.isPrep,
      depth,
    })
  }
  return out
}

/**
 * Cost of one base unit of a prep item, derived from its own recipe rather
 * than from its stored average cost — so a spice price rise reaches every
 * gravy the same day it reaches the bill.
 */
export function prepUnitCost(
  ctx: CostingContext,
  item: Item,
  seen = new Set<string>(),
  depth = 0,
): number {
  const recipe = ctx.recipes.get(recipeKey('PREP', item.id))
  if (!recipe || recipe.yieldQty <= 0) return item.avgCost
  const lines = costRecipe(ctx, 'PREP', item.id, recipe.yieldQty, { explode: true, depth: depth + 1, seen })
  if (!lines.length) return item.avgCost
  const total = lines.reduce((s, l) => s + l.cost, 0)
  return total / recipe.yieldQty
}

/**
 * Sum duplicate ingredients into one line.
 *
 * Exploding a recipe legitimately reaches the same ingredient twice — oil goes
 * straight into the pan and also sits inside the gravy — and a cost sheet that
 * lists oil on two rows reads as an error even though the total is right.
 */
export function mergeCostedLines(lines: CostedLine[]): CostedLine[] {
  const acc = new Map<ID, CostedLine>()
  for (const line of lines) {
    const cur = acc.get(line.itemId)
    if (!cur) { acc.set(line.itemId, { ...line }); continue }
    cur.qty = round(cur.qty + line.qty, 3)
    cur.netQty = round(cur.netQty + line.netQty, 3)
    cur.cost = round(cur.cost + line.cost, 4)
    cur.depth = Math.min(cur.depth, line.depth)
  }
  return [...acc.values()]
}

/** Full plate economics for one dish. */
export function costDish(ctx: CostingContext, dish: Dish, explode = false): DishCosting {
  const lines = mergeCostedLines(costRecipe(ctx, 'DISH', dish.id, 1, { explode }))
  const foodCost = round(lines.reduce((s, l) => s + l.cost, 0), 2)
  // Menu prices in India are GST-inclusive; margin must be measured on net.
  const netPrice = round(dish.price / (1 + (dish.gstPct || 0) / 100), 2)
  const variableCost = round(foodCost + dish.packagingCost + dish.otherVariableCost, 2)
  const contribution = round(netPrice - variableCost, 2)
  return {
    dishId: dish.id,
    name: dish.name,
    price: dish.price,
    netPrice,
    foodCost,
    packagingCost: dish.packagingCost,
    otherVariableCost: dish.otherVariableCost,
    variableCost,
    contribution,
    foodCostPct: netPrice ? round((foodCost / netPrice) * 100, 1) : 0,
    contributionPct: netPrice ? round((contribution / netPrice) * 100, 1) : 0,
    lines: lines.sort((a, b) => b.cost - a.cost),
  }
}

/**
 * Theoretical consumption: what the recipes say should have left the kitchen
 * for a given basket of dishes sold. This is the yardstick every variance in
 * the system is measured against.
 *
 * Left un-exploded by default, because the kitchen physically holds prep items
 * (gravies, pastes) as stock — a sale must deduct the gravy, not the onions
 * that went into it three days ago, or the same onion is counted twice.
 */
export function theoreticalConsumption(
  ctx: CostingContext,
  sold: { dishId: ID; qty: number }[],
  explode = false,
): Map<ID, { qty: number; value: number }> {
  const acc = new Map<ID, { qty: number; value: number }>()
  for (const { dishId, qty } of sold) {
    if (!qty) continue
    for (const line of costRecipe(ctx, 'DISH', dishId, qty, { explode })) {
      const cur = acc.get(line.itemId) ?? { qty: 0, value: 0 }
      cur.qty += line.qty
      cur.value += line.cost
      acc.set(line.itemId, cur)
    }
  }
  return acc
}

/** Which dishes a price change actually hurts, ranked by rupee impact. */
export function priceImpact(
  ctx: CostingContext,
  dishes: Dish[],
  itemId: ID,
  oldCost: number,
  newCost: number,
): { dish: Dish; qtyPerPlate: number; costDelta: number; newFoodCostPct: number }[] {
  const out: { dish: Dish; qtyPerPlate: number; costDelta: number; newFoodCostPct: number }[] = []
  for (const dish of dishes) {
    const lines = mergeCostedLines(costRecipe(ctx, 'DISH', dish.id, 1, { explode: true }))
    const qty = lines.filter((l) => l.itemId === itemId).reduce((s, l) => s + l.qty, 0)
    if (qty <= 0) continue
    const costing = costDish(ctx, dish, true)
    const delta = qty * (newCost - oldCost)
    const netPrice = costing.netPrice || 1
    out.push({
      dish,
      qtyPerPlate: round(qty, 2),
      costDelta: round(delta, 2),
      newFoodCostPct: round(((costing.foodCost + delta) / netPrice) * 100, 1),
    })
  }
  return out.sort((a, b) => Math.abs(b.costDelta) - Math.abs(a.costDelta))
}
