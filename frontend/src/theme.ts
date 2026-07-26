import {
  createDarkTheme,
  createLightTheme,
  type BrandVariants,
  type Theme,
} from '@fluentui/react-components';
import { createContext, useContext } from 'react';

/** Fingrid's grid blue, expanded into a Fluent brand ramp. */
const brand: BrandVariants = {
  10: '#040D17',
  20: '#06182A',
  30: '#07223C',
  40: '#082C50',
  50: '#093764',
  60: '#0A4379',
  70: '#0A4F8F',
  80: '#095CA6',
  90: '#0769BD',
  100: '#0E7CD4',
  110: '#1E90E6',
  120: '#38A5F2',
  130: '#56B8F8',
  140: '#7CCAFB',
  150: '#A8DCFD',
  160: '#D6EEFE',
};

const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", ' +
  'Roboto, "Helvetica Neue", Arial, sans-serif';

/** Every colour the app paints with. Both themes expose the same keys so
 *  components can stay theme-agnostic. */
export interface Palette {
  scheme: 'dark' | 'light';
  bg: string;
  /** Translucent backdrop for the sticky app bar / tab bar. */
  glass: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  /** Brand blue — the measurement series and every active affordance. */
  accent: string;
  accentSoft: string;
  /** Green — a dataset that is being collected into InfluxDB. */
  signal: string;
  signalSoft: string;
  /** Amber — rate limits and other soft warnings. */
  alert: string;
  alertSoft: string;
  positive: string;
  negative: string;
  grid: string;
  shadowCard: string;
  shadowRaised: string;
  tooltipBg: string;
}

const dark: Palette = {
  scheme: 'dark',
  bg: '#080B10',
  glass: 'rgba(8, 11, 16, 0.72)',
  surface: '#11161E',
  surfaceAlt: '#19202A',
  border: '#222A35',
  borderStrong: '#323C4A',
  text: '#E9EFF6',
  textMuted: '#94A3B4',
  textFaint: '#65707F',
  accent: '#38BDF8',
  accentSoft: 'rgba(56, 189, 248, 0.14)',
  signal: '#34D399',
  signalSoft: 'rgba(52, 211, 153, 0.14)',
  alert: '#FBBF24',
  alertSoft: 'rgba(251, 191, 36, 0.14)',
  positive: '#4ADE80',
  negative: '#F87171',
  grid: 'rgba(255, 255, 255, 0.06)',
  shadowCard: '0 1px 2px rgba(0, 0, 0, 0.4)',
  shadowRaised: '0 12px 32px -16px rgba(0, 0, 0, 0.9)',
  tooltipBg: 'rgba(17, 22, 30, 0.96)',
};

const light: Palette = {
  scheme: 'light',
  bg: '#F1F5F9',
  glass: 'rgba(241, 245, 249, 0.8)',
  surface: '#FFFFFF',
  surfaceAlt: '#EDF2F7',
  border: '#DEE5EC',
  borderStrong: '#C6D0DA',
  text: '#0B1220',
  textMuted: '#55637A',
  textFaint: '#8592A6',
  accent: '#0284C7',
  accentSoft: 'rgba(2, 132, 199, 0.10)',
  signal: '#0F766E',
  signalSoft: 'rgba(15, 118, 110, 0.10)',
  alert: '#B45309',
  alertSoft: 'rgba(180, 83, 9, 0.10)',
  positive: '#15803D',
  negative: '#DC2626',
  grid: 'rgba(11, 18, 32, 0.07)',
  shadowCard: '0 1px 2px rgba(11, 18, 32, 0.05)',
  shadowRaised: '0 12px 32px -16px rgba(11, 18, 32, 0.35)',
  tooltipBg: 'rgba(255, 255, 255, 0.98)',
};

export const PALETTES = { dark, light } as const;

/** Fluent's own tokens are re-pointed at the palette so its inputs, switches
 *  and message bars sit flush with the hand-rolled surfaces. */
const applyToFluent = (base: Theme, p: Palette): Theme => ({
  ...base,
  fontFamilyBase: FONT_FAMILY,
  colorNeutralBackground1: p.surface,
  colorNeutralBackground2: p.surfaceAlt,
  colorNeutralBackground3: p.surfaceAlt,
  colorNeutralForeground1: p.text,
  colorNeutralForeground2: p.text,
  colorNeutralForeground3: p.textMuted,
  colorNeutralForeground4: p.textFaint,
  colorNeutralStroke1: p.borderStrong,
  colorNeutralStroke2: p.border,
  colorNeutralStroke3: p.border,
});

export const darkTheme: Theme = {
  ...applyToFluent(createDarkTheme(brand), dark),
  // The generated dark ramp picks a brand foreground that is too dim on our
  // near-black background.
  colorBrandForeground1: brand[110],
  colorBrandForeground2: brand[120],
};

export const lightTheme: Theme = applyToFluent(createLightTheme(brand), light);

/** Mirror the palette onto CSS custom properties so plain CSS (and Griffel
 *  rules, which are static) can reference the active theme. */
export function applyPaletteToDocument(p: Palette) {
  const root = document.documentElement;
  const vars: Record<string, string> = {
    '--bg': p.bg,
    '--glass': p.glass,
    '--surface': p.surface,
    '--surface-alt': p.surfaceAlt,
    '--border': p.border,
    '--border-strong': p.borderStrong,
    '--text': p.text,
    '--text-muted': p.textMuted,
    '--text-faint': p.textFaint,
    '--accent': p.accent,
    '--accent-soft': p.accentSoft,
    '--signal': p.signal,
    '--signal-soft': p.signalSoft,
    '--alert': p.alert,
    '--alert-soft': p.alertSoft,
    '--positive': p.positive,
    '--negative': p.negative,
    '--shadow-card': p.shadowCard,
    '--shadow-raised': p.shadowRaised,
  };
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  root.dataset.theme = p.scheme;
  root.style.colorScheme = p.scheme;

  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.bg);
}

const PaletteContext = createContext<Palette>(dark);
export const PaletteProvider = PaletteContext.Provider;

/** Colours for anything that can't go through CSS variables — Recharts props,
 *  inline SVG fills and the like. */
export const usePalette = () => useContext(PaletteContext);
