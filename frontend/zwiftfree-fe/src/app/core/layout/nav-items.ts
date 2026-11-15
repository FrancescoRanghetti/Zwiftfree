export interface NavItem {
  path: string;
  icon: string;
  labelKey: string;
  descKey?: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/home', icon: 'home', labelKey: 'nav.home' },
  { path: '/ride', icon: 'directions_bike', labelKey: 'nav.ride', descKey: 'home.rideDesc' },
  { path: '/routes', icon: 'map', labelKey: 'nav.routes', descKey: 'home.routesDesc' },
  { path: '/stats', icon: 'monitoring', labelKey: 'nav.stats', descKey: 'home.statsDesc' },
  { path: '/history', icon: 'history', labelKey: 'nav.history', descKey: 'home.historyDesc' },
  { path: '/live', icon: 'cast', labelKey: 'nav.live' },
  { path: '/account', icon: 'person', labelKey: 'nav.account', descKey: 'home.accountDesc' },
  { path: '/settings', icon: 'settings', labelKey: 'nav.settings', descKey: 'home.settingsDesc' },
];
