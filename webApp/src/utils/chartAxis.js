/**
 * Round y-axis ticks for unit-count charts: the smallest whole step of
 * 1/2/2.5/5 × 10^n that covers the data plus ~15% headroom (minimum 4) in at
 * most `maxIntervals` steps, so a 292-unit month reads 0/100/…/400 rather than
 * 0/85/170/255/336. Counts are never fractional, so neither are the steps.
 */
export const niceAxis = (max, maxIntervals = 5) => {
  const top = Math.max(4, Math.ceil((Number(max) || 0) * 1.15));
  let step = 1;
  for (let magnitude = 1; ; magnitude *= 10) {
    const fit = [1, 2, 2.5, 5]
      .map((m) => m * magnitude)
      .find((candidate) => Number.isInteger(candidate) && Math.ceil(top / candidate) <= maxIntervals);
    if (fit) { step = fit; break; }
  }
  const intervals = Math.ceil(top / step);
  const ticks = Array.from({ length: intervals + 1 }, (_, i) => i * step);
  const last = ticks[ticks.length - 1];
  // Recharts YAxis width: ~7px per 10px-font digit plus tick spacing, so the
  // widest label is never clipped by the chart's left edge.
  const width = Math.max(32, 8 + 7 * String(last).length);
  return { domain: [0, last], ticks, width };
};
