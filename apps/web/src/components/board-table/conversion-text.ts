/** "42 values will be converted and 3 can't be converted and will be cleared." */
export function describeConversionCounts(converted: number, cleared: number): string {
  const values = (n: number) => `${n} ${n === 1 ? 'value' : 'values'}`;
  if (converted === 0 && cleared === 0) return 'There are no values to convert.';
  if (cleared === 0) {
    return `${values(converted)} will be converted.`;
  }
  if (converted === 0) {
    return `${values(cleared)} can't be converted and will be cleared.`;
  }
  const cannot = cleared === 1 ? "1 can't be converted" : `${cleared} can't be converted`;
  return `${values(converted)} will be converted and ${cannot} and will be cleared.`;
}
