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

/** `columnId -> key` for reading cells by title: the first column of a title keeps it, a later one with the same title becomes `Title (columnId)`. */
export function uniqueColumnTitles(columns) {
  const out = new Map();
  const taken = new Set();
  for (const column of columns) {
    const dup = taken.has(column.title.toLowerCase());
    taken.add(column.title.toLowerCase());
    out.set(column.id, dup ? `${column.title} (${column.id})` : column.title);
  }
  return out;
}
