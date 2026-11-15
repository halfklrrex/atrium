/** Move the item at `from` to position `to` (both clamped). Returns the same array if nothing moves. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const last = list.length - 1;
  if (from < 0 || from > last) return [...list];
  const target = Math.max(0, Math.min(last, to));
  if (target === from) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item as T);
  return next;
}

/** Move the item with `id` onto the position of the item with `overId` (a drag-and-drop result). */
export function moveItemOver<T>(
  list: readonly T[],
  getId: (item: T) => string | number,
  id: string | number,
  overId: string | number,
): T[] {
  return moveItem(
    list,
    list.findIndex((i) => getId(i) === id),
    list.findIndex((i) => getId(i) === overId),
  );
}
