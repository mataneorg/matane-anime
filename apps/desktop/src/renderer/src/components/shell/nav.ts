import {
  Download,
  Globe,
  History,
  LibraryBig,
  type LucideIcon,
  Package,
  RefreshCw,
  ScanSearch,
  Settings2,
} from 'lucide-react';

export interface NavItem {
  to:
    | '/library'
    | '/updates'
    | '/history'
    | '/browse/sources'
    | '/browse/extensions'
    | '/browse/global-search'
    | '/downloads';
  /** Key under `nav.*` in the locale files. */
  label: 'library' | 'updates' | 'history' | 'sources' | 'extensions' | 'globalSearch' | 'downloads';
  icon: LucideIcon;
}

export const MAIN_NAV: NavItem[] = [
  { to: '/library', label: 'library', icon: LibraryBig },
  { to: '/updates', label: 'updates', icon: RefreshCw },
  { to: '/history', label: 'history', icon: History },
];

export const BROWSE_NAV: NavItem[] = [
  { to: '/browse/sources', label: 'sources', icon: Globe },
  { to: '/browse/extensions', label: 'extensions', icon: Package },
  { to: '/browse/global-search', label: 'globalSearch', icon: ScanSearch },
];

export const DOWNLOADS_NAV: NavItem = { to: '/downloads', label: 'downloads', icon: Download };

export const SETTINGS_ICON = Settings2;
