/** dnd-kit ids of a widget's two drag handles, and the way back. */
export const moveHandleId = (widgetId: string): string => `move:${widgetId}`;
export const resizeHandleId = (widgetId: string): string => `resize:${widgetId}`;

export function parseHandleId(id: string): { kind: 'move' | 'resize'; widgetId: string } | null {
  const [kind, ...rest] = id.split(':');
  return (kind === 'move' || kind === 'resize') && rest.length > 0
    ? { kind, widgetId: rest.join(':') }
    : null;
}
