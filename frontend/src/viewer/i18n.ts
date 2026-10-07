import { createContext, useContext } from 'react';
import type { Dataset } from '../types';

export type Lang = 'fi' | 'en';

const en = {
  appName: 'FingridFlow Live',
  tagline: 'Finland’s power system, live',
  navNow: 'Grid now',
  navExplore: 'All data',
  switchTheme: 'Switch theme',
  switchLanguage: 'Suomeksi',

  // Grid now
  nowTitle: 'Power system now',
  updated: 'Updated',
  autoRefresh: 'refreshes automatically',
  stale: 'Showing the last values received — Fingrid is not answering right now.',
  loading: 'Loading live data…',
  loadFailed: 'Could not load live data',
  loadFailedBody: 'Fingrid did not answer. The page tries again automatically.',
  retry: 'Try again',
  consumption: 'Consumption',
  production: 'Production',
  netExport: 'Net export',
  netImport: 'Net import',
  netBalanced: 'Balanced',
  frequency: 'Frequency',
  emissions: 'CO₂ of consumption',
  emissionsProduction: 'CO₂ of production',
  peak24h: '24 h peak',
  ofConsumption: 'of consumption',
  fromNominal: 'from 50 Hz',
  forecast: 'forecast',
  now: 'Now',

  stateLabel: 'System state',
  state1: 'Normal',
  state2: 'Endangered',
  state3: 'Disturbed',
  state4: 'Serious disturbance',
  state5: 'Restoring',
  stateUnknown: 'Unknown',
  shortage1: 'Electricity shortage possible',
  shortage2: 'High risk of electricity shortage',
  shortage3: 'Electricity shortage — consumption is being restricted',
  shortageHint: 'Save electricity. Fingrid publishes instructions on fingrid.fi.',

  mixTitle: 'Production by source',
  mixSubtitle: 'Last 24 hours, stacked, with consumption on top',
  mixShare: 'share',
  balanceTitle: 'Consumption and production',
  balanceSubtitle: 'Last 24 hours and Fingrid’s forecast for the next 24',
  flowsTitle: 'Cross-border transmission',
  flowsSubtitle: 'Positive is export from Finland',
  export: 'Export',
  import: 'Import',
  idle: 'No flow',
  frequencyTitle: 'Frequency',
  frequencySubtitle: 'Normal band 49.9–50.1 Hz, 3-minute samples',
  emissionsTitle: 'Emission factor',
  emissionsSubtitle: 'Estimated gCO₂ per kWh, real time',
  openDataset: 'Open dataset',

  hydro: 'Hydro',
  nuclear: 'Nuclear',
  wind: 'Wind',
  solar: 'Solar (estimate)',
  chpDistrict: 'CHP, district heating',
  chpIndustry: 'CHP, industry',
  other: 'Other & reserve',
  consumptionForecast: 'Consumption forecast',
  productionForecast: 'Production forecast',

  se1: 'Northern Sweden (SE1)',
  se3: 'Central Sweden (SE3)',
  norway: 'Norway',
  estonia: 'Estonia',
  russia: 'Russia',
  finland: 'Finland',

  // Catalog
  exploreTitle: 'All Fingrid data',
  exploreCount: (shown: number, total: number) => `${shown} of ${total} datasets`,
  exploreSubtitle: 'Fingrid open data catalog',
  searchPlaceholder: 'Search by name, description or ID…',
  clearSearch: 'Clear search',
  filters: 'Filters',
  filtersActive: (n: number) => `Filters (${n} active)`,
  matching: (n: number) => `${n} datasets match`,
  all: 'All',
  category: 'Category',
  unit: 'Unit',
  reset: 'Reset',
  showResults: 'Show results',
  catalogFailed: 'Could not load the catalog',
  catalogFailedBody: 'Fingrid did not answer. Try again in a moment.',
  noMatches: 'No matching datasets',
  noMatchesBody: 'Try a different search term, or clear the filters.',
  clearFilters: 'Clear filters',
  featured: 'Live on the front page',

  // Dataset
  back: 'Back',
  share: 'Share',
  copied: 'Link copied',
  latest: 'Latest',
  average: 'Average',
  lowest: 'Lowest',
  highest: 'Highest',
  range24h: '24 h',
  range3d: '3 days',
  range7d: '7 days',
  range30d: '30 days',
  rangeLabel: 'Time range',
  chart: 'Chart',
  table: 'Table',
  downloadCsv: 'Download CSV',
  previewFailed: 'Data unavailable',
  previewFailedBody: 'Fingrid did not return data for this dataset.',
  noReadings: 'No readings in this window',
  noReadingsBody: 'Fingrid published no values for this dataset in the selected time range. Try a longer range.',
  truncated: 'This window holds more rows than Fingrid returns at once, so only the newest are shown. Pick a shorter range for the full detail.',
  forecastNote: 'Values to the right of “Now” are a forecast.',
  about: 'About this dataset',
  datasetId: 'Dataset ID',
  interval: 'Interval',
  otherName: 'Finnish name',
  categories: 'Categories',
  points: 'Points',
  source: 'Source',
  sourceLink: 'data.fingrid.fi',
  notFound: 'Dataset not found',
  notFoundBody: 'There is no Fingrid dataset with this ID.',
  time: 'Time',
  value: 'Value',
  tableRows: (shown: number, total: number) =>
    shown < total ? `Newest ${shown} of ${total} rows. The CSV has them all.` : `${total} rows`,

  footer: 'Data: Fingrid Open Data, licensed CC BY 4.0. Not an official Fingrid service.',
};

type Strings = typeof en;

const fi: Strings = {
  appName: 'FingridFlow Live',
  tagline: 'Suomen sähköjärjestelmä reaaliajassa',
  navNow: 'Tilanne nyt',
  navExplore: 'Kaikki data',
  switchTheme: 'Vaihda teema',
  switchLanguage: 'In English',

  nowTitle: 'Sähköjärjestelmä nyt',
  updated: 'Päivitetty',
  autoRefresh: 'päivittyy automaattisesti',
  stale: 'Näytetään viimeisimmät saadut arvot — Fingrid ei juuri nyt vastaa.',
  loading: 'Ladataan reaaliaikaista dataa…',
  loadFailed: 'Reaaliaikaista dataa ei saatu',
  loadFailedBody: 'Fingrid ei vastannut. Sivu yrittää automaattisesti uudelleen.',
  retry: 'Yritä uudelleen',
  consumption: 'Kulutus',
  production: 'Tuotanto',
  netExport: 'Nettovienti',
  netImport: 'Nettotuonti',
  netBalanced: 'Tasapainossa',
  frequency: 'Taajuus',
  emissions: 'Kulutuksen CO₂',
  emissionsProduction: 'Tuotannon CO₂',
  peak24h: '24 h huippu',
  ofConsumption: 'kulutuksesta',
  fromNominal: 'poikkeama 50 Hz:stä',
  forecast: 'ennuste',
  now: 'Nyt',

  stateLabel: 'Järjestelmän tila',
  state1: 'Normaali',
  state2: 'Vaarantunut',
  state3: 'Häiriö',
  state4: 'Vakava häiriö',
  state5: 'Käytönpalautus',
  stateUnknown: 'Ei tiedossa',
  shortage1: 'Sähköpula mahdollinen',
  shortage2: 'Sähköpulan riski suuri',
  shortage3: 'Sähköpula — kulutusta rajoitetaan',
  shortageHint: 'Säästä sähköä. Fingrid julkaisee ohjeet osoitteessa fingrid.fi.',

  mixTitle: 'Tuotanto tuotantomuodoittain',
  mixSubtitle: 'Viimeiset 24 tuntia pinottuna, päällä kulutus',
  mixShare: 'osuus',
  balanceTitle: 'Kulutus ja tuotanto',
  balanceSubtitle: 'Viimeiset 24 tuntia ja Fingridin ennuste seuraaville 24',
  flowsTitle: 'Siirrot naapurimaihin',
  flowsSubtitle: 'Positiivinen arvo on vientiä Suomesta',
  export: 'Vienti',
  import: 'Tuonti',
  idle: 'Ei siirtoa',
  frequencyTitle: 'Taajuus',
  frequencySubtitle: 'Normaalialue 49,9–50,1 Hz, 3 minuutin näytteet',
  emissionsTitle: 'Päästökerroin',
  emissionsSubtitle: 'Arvioitu gCO₂ kilowattitunnille, reaaliaikainen',
  openDataset: 'Avaa tietoaineisto',

  hydro: 'Vesivoima',
  nuclear: 'Ydinvoima',
  wind: 'Tuulivoima',
  solar: 'Aurinkovoima (arvio)',
  chpDistrict: 'Kaukolämmön yhteistuotanto',
  chpIndustry: 'Teollisuuden yhteistuotanto',
  other: 'Muu tuotanto ja varavoima',
  consumptionForecast: 'Kulutusennuste',
  productionForecast: 'Tuotantoennuste',

  se1: 'Pohjois-Ruotsi (SE1)',
  se3: 'Keski-Ruotsi (SE3)',
  norway: 'Norja',
  estonia: 'Viro',
  russia: 'Venäjä',
  finland: 'Suomi',

  exploreTitle: 'Kaikki Fingridin data',
  exploreCount: (shown, total) => `${shown} / ${total} tietoaineistoa`,
  exploreSubtitle: 'Fingridin avoimen datan luettelo',
  searchPlaceholder: 'Hae nimellä, kuvauksella tai tunnisteella…',
  clearSearch: 'Tyhjennä haku',
  filters: 'Suodattimet',
  filtersActive: n => `Suodattimet (${n} käytössä)`,
  matching: n => `${n} tietoaineistoa`,
  all: 'Kaikki',
  category: 'Aihealue',
  unit: 'Yksikkö',
  reset: 'Tyhjennä',
  showResults: 'Näytä tulokset',
  catalogFailed: 'Luetteloa ei saatu',
  catalogFailedBody: 'Fingrid ei vastannut. Yritä hetken päästä uudelleen.',
  noMatches: 'Ei osumia',
  noMatchesBody: 'Kokeile toista hakusanaa tai poista suodattimet.',
  clearFilters: 'Poista suodattimet',
  featured: 'Etusivun reaaliaikaiset',

  back: 'Takaisin',
  share: 'Jaa',
  copied: 'Linkki kopioitu',
  latest: 'Viimeisin',
  average: 'Keskiarvo',
  lowest: 'Pienin',
  highest: 'Suurin',
  range24h: '24 h',
  range3d: '3 vrk',
  range7d: '7 vrk',
  range30d: '30 vrk',
  rangeLabel: 'Aikaväli',
  chart: 'Kaavio',
  table: 'Taulukko',
  downloadCsv: 'Lataa CSV',
  previewFailed: 'Dataa ei saatu',
  previewFailedBody: 'Fingrid ei palauttanut dataa tälle tietoaineistolle.',
  noReadings: 'Ei arvoja tällä aikavälillä',
  noReadingsBody: 'Fingrid ei ole julkaissut tälle tietoaineistolle arvoja valitulla aikavälillä. Kokeile pidempää aikaväliä.',
  truncated: 'Aikavälillä on enemmän rivejä kuin Fingrid palauttaa kerralla, joten vain uusimmat näytetään. Valitse lyhyempi aikaväli nähdäksesi kaiken.',
  forecastNote: '”Nyt”-viivan oikealla puolella olevat arvot ovat ennustetta.',
  about: 'Tietoa aineistosta',
  datasetId: 'Tunniste',
  interval: 'Aikaresoluutio',
  otherName: 'Englanninkielinen nimi',
  categories: 'Aihealueet',
  points: 'Pisteitä',
  source: 'Lähde',
  sourceLink: 'data.fingrid.fi',
  notFound: 'Tietoaineistoa ei löydy',
  notFoundBody: 'Fingridillä ei ole tietoaineistoa tällä tunnisteella.',
  time: 'Aika',
  value: 'Arvo',
  tableRows: (shown, total) =>
    shown < total ? `Uusimmat ${shown} / ${total} riviä. CSV sisältää kaikki.` : `${total} riviä`,

  footer: 'Data: Fingridin avoin data, lisenssi CC BY 4.0. Ei Fingridin virallinen palvelu.',
};

export const STRINGS: Record<Lang, Strings> = { en, fi };

export interface I18n {
  lang: Lang;
  t: Strings;
  /** BCP 47 tag for number and date formatting. */
  locale: string;
}

export const makeI18n = (lang: Lang): I18n => ({
  lang,
  t: STRINGS[lang],
  locale: lang === 'fi' ? 'fi-FI' : 'en-GB',
});

const I18nContext = createContext<I18n>(makeI18n('en'));
export const I18nProvider = I18nContext.Provider;
export const useI18n = () => useContext(I18nContext);

export const initialLang = (): Lang => {
  try {
    const stored = localStorage.getItem('lang');
    if (stored === 'fi' || stored === 'en') return stored;
  } catch {
    // Storage blocked — fall through to the browser language.
  }
  return navigator.language?.toLowerCase().startsWith('fi') ? 'fi' : 'en';
};

// ── Catalog fields in the chosen language, falling back to the other ──────────

export const dsName = (d: Dataset, lang: Lang) => (lang === 'fi' ? d.nameFi || d.nameEn : d.nameEn || d.nameFi);
export const dsOtherName = (d: Dataset, lang: Lang) => (lang === 'fi' ? d.nameEn : d.nameFi);
export const dsDescription = (d: Dataset, lang: Lang) =>
  (lang === 'fi' ? d.descriptionFi || d.descriptionEn : d.descriptionEn || d.descriptionFi) ?? '';
export const dsUnit = (d: Dataset, lang: Lang) =>
  ((lang === 'fi' ? d.unitFi || d.unitEn : d.unitEn || d.unitFi) ?? '').trim();
export const dsPeriod = (d: Dataset, lang: Lang) =>
  (lang === 'fi' ? d.dataPeriodFi || d.dataPeriodEn : d.dataPeriodEn || d.dataPeriodFi) ?? '';
export const dsGroups = (d: Dataset, lang: Lang) =>
  (lang === 'fi' ? d.contentGroupsFi ?? d.contentGroupsEn : d.contentGroupsEn ?? d.contentGroupsFi) ?? [];
