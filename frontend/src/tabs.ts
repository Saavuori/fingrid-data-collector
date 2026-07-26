import {
  GlobeSearch24Regular,
  GlobeSearch24Filled,
  Database24Regular,
  Database24Filled,
  Settings24Regular,
  Settings24Filled,
} from '@fluentui/react-icons';
import type React from 'react';
import type { TabKey } from './types';

export interface TabDef {
  key: TabKey;
  label: string;
  icon: React.FC<{ fontSize?: number }>;
  iconActive: React.FC<{ fontSize?: number }>;
}

/** The three sections of the app, in tab-bar order. */
export const TABS: TabDef[] = [
  { key: 'explore', label: 'Explore', icon: GlobeSearch24Regular, iconActive: GlobeSearch24Filled },
  { key: 'collect', label: 'Collect', icon: Database24Regular, iconActive: Database24Filled },
  { key: 'settings', label: 'Settings', icon: Settings24Regular, iconActive: Settings24Filled },
];
