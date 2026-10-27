import type { AppView } from '../types'

export type NavGroup = 'Daily' | 'Prepare' | 'Tools'

type NavItem = {
  view: AppView
  label: string
  symbol: string
  group: NavGroup
  /** Reachable from another page but kept out of the menus. */
  hidden?: boolean
  /** Menu item highlighted while a hidden view is open. */
  parent?: AppView
}

// The view id 'dashboard' is kept for the Overview page because it is stored
// as a synchronized start page (user_settings.default_view check constraint).
const ALL_VIEWS: NavItem[] = [
  { view: 'dashboard', label: 'Overview', symbol: '◫', group: 'Daily' },
  { view: 'board', label: 'Board', symbol: '▦', group: 'Daily' },
  { view: 'applications', label: 'Applications', symbol: '≡', group: 'Daily' },
  { view: 'reminders', label: 'Reminders', symbol: '◷', group: 'Daily' },
  { view: 'contacts', label: 'Network', symbol: '◎', group: 'Prepare' },
  { view: 'outreach', label: 'Outreach', symbol: '✉', group: 'Prepare', hidden: true, parent: 'contacts' },
  { view: 'interviews', label: 'Interviews', symbol: '✦', group: 'Prepare' },
  { view: 'cvs', label: 'CV library', symbol: '▤', group: 'Prepare' },
  { view: 'search', label: 'Find jobs', symbol: '⌕', group: 'Tools' },
  { view: 'backup', label: 'Backup', symbol: '⇅', group: 'Tools' },
  { view: 'settings', label: 'Settings', symbol: '⚙', group: 'Tools' },
]

export const NAV_GROUPS: NavGroup[] = ['Daily', 'Prepare', 'Tools']

export const NAV_ITEMS = ALL_VIEWS.filter((item) => !item.hidden)

/** The menu entry to highlight for a view: itself, or its parent when hidden. */
export function activeNavView(view: AppView): AppView {
  return ALL_VIEWS.find((item) => item.view === view)?.parent ?? view
}

export function viewTitle(view: AppView) {
  return ALL_VIEWS.find((item) => item.view === view)?.label ?? 'Opportunity Desk'
}
