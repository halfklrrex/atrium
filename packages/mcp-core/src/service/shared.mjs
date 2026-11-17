// Pure helpers shared by the service modules.

export function labelSummary(column) {
  const s = column.settings ?? {};
  if (column.type === 'status')
    return { labels: s.labels.map((l) => ({ label: l.label, color: l.color })) };
  if (column.type === 'dropdown') return { options: s.labels.map((l) => l.label) };
  if (column.type === 'tags') return { tags: (s.tags ?? []).map((t) => t.name) };
  if (column.type === 'rating') return { limit: s.limit, symbol: s.symbol };
  return {};
}
