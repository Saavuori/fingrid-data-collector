/** Fingrid variables span frequency (49.98 Hz) to system load (12 000 MW), so
 *  precision is derived from how much the series actually moves. Going by
 *  magnitude alone would round the whole frequency range to a flat "50.0". */
export const precisionFor = (values: number[]): number => {
  if (values.length === 0) return 2;
  let min = values[0];
  let max = values[0];
  let magnitude = 0;
  // Reduced rather than spread into Math.max — a week of 3-minute data is
  // thousands of points, enough to overflow the argument list.
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    magnitude = Math.max(magnitude, Math.abs(v));
  }
  const scale = max - min > 0 ? max - min : magnitude;
  if (scale >= 100) return 0;
  if (scale >= 10) return 1;
  if (scale >= 1) return 2;
  if (scale >= 0.1) return 3;
  return 4;
};

export const formatValue = (value: number, digits: number, locale?: string): string =>
  value.toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
