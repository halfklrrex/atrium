/** Sizes the drawing reads from the chart tokens (see `theme/chart-tokens.css`). */
export interface ChartMetrics {
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  charWidth: number;
  barPadding: number;
  pointRadius: number;
  sliceGap: number;
  donutRatio: number;
  piePadding: number;
  tooltipOffset: number;
}

const FALLBACK: ChartMetrics = {
  marginTop: 24,
  marginRight: 16,
  marginBottom: 40,
  marginLeft: 56,
  charWidth: 7,
  barPadding: 0.3,
  pointRadius: 4,
  sliceGap: 2,
  donutRatio: 0.6,
  piePadding: 24,
  tooltipOffset: 12,
};

/** Reads the chart tokens off an element (the fallbacks apply outside a browser). */
export function readMetrics(element: Element | null): ChartMetrics {
  if (!element || typeof getComputedStyle !== 'function') return FALLBACK;
  const style = getComputedStyle(element);
  const read = (name: string, fallback: number): number => {
    const value = parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    marginTop: read('--atrium-chart-margin-top', FALLBACK.marginTop),
    marginRight: read('--atrium-chart-margin-right', FALLBACK.marginRight),
    marginBottom: read('--atrium-chart-margin-bottom', FALLBACK.marginBottom),
    marginLeft: read('--atrium-chart-margin-left', FALLBACK.marginLeft),
    charWidth: read('--atrium-chart-char-width', FALLBACK.charWidth),
    barPadding: read('--atrium-chart-bar-padding', FALLBACK.barPadding),
    pointRadius: read('--atrium-chart-point-radius', FALLBACK.pointRadius),
    sliceGap: read('--atrium-chart-slice-gap', FALLBACK.sliceGap),
    donutRatio: read('--atrium-chart-donut-ratio', FALLBACK.donutRatio),
    piePadding: read('--atrium-chart-pie-padding', FALLBACK.piePadding),
    tooltipOffset: read('--atrium-chart-tooltip-offset', FALLBACK.tooltipOffset),
  };
}
