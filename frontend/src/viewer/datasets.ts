import type { Palette } from '../theme';
import type { STRINGS } from './i18n';

/** Fingrid dataset ids the "Grid now" page reads. Keep in step with
 *  DASHBOARD_IDS in backend/src/bin/fingrid-viewer/main.rs. */
export const ID = {
  consumption: 193,
  production: 192,
  netExport: 194, // positive = net export from Finland
  consumptionForecast: 166,
  productionForecast: 241,
  wind: 181,
  nuclear: 188,
  hydro: 191,
  chpDistrict: 201,
  chpIndustry: 202,
  other: 205,
  peakLoad: 183,
  solar: 248, // Fingrid's own real-time solar estimate is its 15-minute forecast
  batteryDischarge: 398,
  batteryCharge: 399,
  se1: 87, // positive = transmission from Finland to the neighbour
  se3: 89,
  norway: 187,
  estonia: 180,
  russia: 195,
  systemState: 209,
  frequency: 177,
  co2Consumption: 265,
  co2Production: 266,
  shortage: 336,
} as const;

export const FEATURED_IDS: number[] = Object.values(ID);

type StringKey = keyof (typeof STRINGS)['en'];

/** Categorical slots in fixed order (validated adjacent-pair CVD-safe in both
 *  themes; see the dataviz palette). The mix stacks in this order, so every
 *  neighbouring band is a validated neighbouring pair. */
const CATEGORICAL = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
} as const;

export const seriesColor = (palette: Palette, slot: number) => CATEGORICAL[palette.scheme][slot];

export interface MixSource {
  key: StringKey;
  /** Summed — "other" folds reserve plants and battery discharge into 205. */
  ids: number[];
  slot: number;
}

export const MIX: MixSource[] = [
  { key: 'hydro', ids: [ID.hydro], slot: 0 },
  { key: 'nuclear', ids: [ID.nuclear], slot: 1 },
  { key: 'wind', ids: [ID.wind], slot: 2 },
  { key: 'solar', ids: [ID.solar], slot: 3 },
  { key: 'chpDistrict', ids: [ID.chpDistrict], slot: 4 },
  { key: 'chpIndustry', ids: [ID.chpIndustry], slot: 5 },
  { key: 'other', ids: [ID.other, ID.peakLoad, ID.batteryDischarge], slot: 6 },
];

export interface Border {
  key: StringKey;
  id: number;
  /** Shown only while it carries a value — trade with Russia stopped in 2022. */
  optional?: boolean;
}

export const BORDERS: Border[] = [
  { key: 'se1', id: ID.se1 },
  { key: 'se3', id: ID.se3 },
  { key: 'norway', id: ID.norway },
  { key: 'estonia', id: ID.estonia },
  { key: 'russia', id: ID.russia, optional: true },
];
