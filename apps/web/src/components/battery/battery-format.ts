/**
 * Tooltip text of one battery segment: "<Label> <count>/<total>   <percent>%" (three spaces before
 * the percent, as monday does). The percent has one decimal, and a whole number drops it. The empty
 * label reads "Empty".
 */
export function formatBatteryTooltip(label: string, count: number, total: number): string {
  const percent = total > 0 ? (count / total) * 100 : 0;
  const rounded = Math.round(percent * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${label || 'Empty'} ${count}/${total}   ${text}%`;
}
