import type { StaffRole } from '../core/types'

export interface NavItem {
  path: string
  label: string
  icon: string
  desc?: string
  roles?: StaffRole[]
}

export interface NavGroup {
  id: string
  label: string
  icon: string
  items: NavItem[]
  roles?: StaffRole[]
}

const ALL: StaffRole[] = ['OWNER', 'MANAGER', 'HEAD_CHEF', 'CHEF', 'STORE', 'ACCOUNTS']

/**
 * Every screen sits under exactly one category, and each category opens as a
 * dropdown. Forty screens on one bar would be unusable; nine categories with
 * their own menus is how an operations tool stays navigable.
 */
export const NAV: NavGroup[] = [
  {
    id: 'sop', label: 'SOP & Menu', icon: '📖',
    items: [
      { path: '/menu/recipes', label: 'Recipe SOPs', icon: '📋', desc: 'Quantities, method, control points' },
      { path: '/menu/prep', label: 'Prep & Sub-recipes', icon: '🥣', desc: 'Gravies, pastes, masala blends' },
      { path: '/menu/dishes', label: 'Menu Dishes', icon: '🍽', desc: 'Prices, categories, sections' },
      { path: '/menu/costing', label: 'Plate Costing', icon: '🧮', desc: 'Live cost and margin per dish' },
      { path: '/menu/engineering', label: 'Menu Engineering', icon: '🎯', desc: 'Stars, puzzles, dogs' },
    ],
  },
  {
    id: 'purchase', label: 'Purchases', icon: '🧾',
    roles: ['OWNER', 'MANAGER', 'STORE', 'ACCOUNTS'],
    items: [
      { path: '/purchase/upload', label: 'Upload Bill (PDF)', icon: '📄', desc: 'Read a supplier invoice automatically' },
      { path: '/purchase/manual', label: 'Manual Bill Entry', icon: '✍️', desc: 'For handwritten kaccha bills' },
      { path: '/purchase/register', label: 'Purchase Register', icon: '📚', desc: 'Every bill, searchable' },
      { path: '/purchase/prices', label: 'Price Watch', icon: '📈', desc: 'Rate movements and dish impact' },
      { path: '/purchase/suppliers', label: 'Suppliers', icon: '🚚', desc: 'Terms, lead times, scores' },
    ],
  },
  {
    id: 'store', label: 'Store', icon: '📦',
    roles: ['OWNER', 'MANAGER', 'STORE', 'HEAD_CHEF'],
    items: [
      { path: '/store/receipts', label: 'Goods Receipt', icon: '📥', desc: 'Add received stock to opening balance' },
      { path: '/store/stock', label: 'Store Stock', icon: '🏬', desc: 'On hand, value, cover' },
      { path: '/store/issue', label: 'Issue to Kitchen', icon: '➡️', desc: 'Full indent with approvals' },
      { path: '/store/stocktake', label: 'Store Stocktake', icon: '🔢', desc: 'Physical count sheet' },
    ],
  },
  {
    id: 'kitchen', label: 'Kitchen', icon: '👨‍🍳',
    items: [
      { path: '/kitchen/quick-take', label: 'Quick Take', icon: '⚡', desc: 'Tap, type, done — built for service' },
      { path: '/kitchen/production', label: 'Prep Production', icon: '🍲', desc: 'Batch gravies and pastes' },
      { path: '/kitchen/stock', label: 'Kitchen Stock', icon: '🧊', desc: 'What is on the line right now' },
      { path: '/kitchen/wastage', label: 'Wastage & Staff Meals', icon: '🗑', desc: 'Record it before it hides in variance' },
      { path: '/kitchen/stocktake', label: 'Kitchen Stocktake', icon: '🔢', desc: 'End-of-day physical count' },
    ],
  },
  {
    id: 'sales', label: 'Sales', icon: '💳',
    roles: ['OWNER', 'MANAGER', 'ACCOUNTS', 'HEAD_CHEF'],
    items: [
      { path: '/sales/entry', label: 'Daily Sales Entry', icon: '🧮', desc: 'Enter or adjust the day’s covers' },
      { path: '/sales/import', label: 'Import from POS', icon: '📤', desc: 'CSV from any billing system' },
      { path: '/sales/register', label: 'Sales Register', icon: '📒', desc: 'Day by day, channel by channel' },
      { path: '/sales/dishes', label: 'Dish Performance', icon: '⭐', desc: 'Best sellers and what they earn' },
    ],
  },
  {
    id: 'eod', label: 'Day Close', icon: '🌙',
    roles: ['OWNER', 'MANAGER', 'HEAD_CHEF', 'STORE'],
    items: [
      { path: '/eod/close', label: 'Close the Day', icon: '✅', desc: 'Four steps: sales, count, review, sign off' },
      { path: '/eod/variance', label: 'Variance Review', icon: '⚖️', desc: 'Expected against counted' },
      { path: '/eod/history', label: 'Close History', icon: '🗓', desc: 'Past closes and their notes' },
    ],
  },
  {
    id: 'reports', label: 'Reports', icon: '📊',
    roles: ['OWNER', 'MANAGER', 'ACCOUNTS', 'HEAD_CHEF'],
    items: [
      { path: '/reports/pnl', label: 'Food Cost & P&L', icon: '💰', desc: 'Month on month, with the drift' },
      { path: '/reports/variance', label: 'Variance Report', icon: '🔍', desc: 'Against recipe and against normal' },
      { path: '/reports/chefs', label: 'Chef Efficiency', icon: '🏅', desc: 'P&L and contribution by chef' },
      { path: '/reports/trends', label: 'Trends vs Average', icon: '📉', desc: 'How far today sits from normal' },
      { path: '/reports/movement', label: 'Item Movement', icon: '🔄', desc: 'Every movement, traceable' },
      { path: '/reports/wastage', label: 'Wastage Analysis', icon: '♻️', desc: 'What is being thrown away' },
      { path: '/reports/valuation', label: 'Stock Valuation', icon: '🏦', desc: 'What the shelves are worth' },
    ],
  },
  {
    id: 'setup', label: 'Setup', icon: '⚙️',
    roles: ['OWNER', 'MANAGER'],
    items: [
      { path: '/setup/items', label: 'Items & Ingredients', icon: '🧂', desc: 'Units, yields, par levels' },
      { path: '/setup/categories', label: 'Categories', icon: '🗂', desc: 'Category tree and tolerances' },
      { path: '/setup/locations', label: 'Locations', icon: '📍', desc: 'Stores, cold rooms, kitchen' },
      { path: '/setup/staff', label: 'Staff & Roles', icon: '👥', desc: 'Chefs, sections, access' },
      { path: '/setup/data', label: 'Data & Backup', icon: '💾', desc: 'Export, restore, reset' },
    ],
  },
]

export function visibleNav(role: StaffRole | undefined): NavGroup[] {
  if (!role) return NAV
  return NAV
    .filter((g) => !g.roles || g.roles.includes(role))
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.roles || i.roles.includes(role)) }))
    .filter((g) => g.items.length > 0)
}

export function findNavItem(path: string): { group: NavGroup; item: NavItem } | null {
  for (const group of NAV) {
    for (const item of group.items) {
      if (item.path === path) return { group, item }
    }
  }
  return null
}

export const ROLE_LABEL: Record<StaffRole, string> = {
  OWNER: 'Owner', MANAGER: 'Manager', HEAD_CHEF: 'Head Chef',
  CHEF: 'Chef', STORE: 'Store Keeper', ACCOUNTS: 'Accounts',
}

export { ALL as ALL_ROLES }
