import type { KeyboardEvent } from 'react';

/**
 * Arrow-key navigation for a grid of buttons that carry `data-grid-cell`. Left and right move to
 * the previous and next cell in DOM order; up and down to the nearest cell in the row above or
 * below (by position, so it works across the group headings). Home and End jump to the ends.
 */
export function handleGridKeys(event: KeyboardEvent<HTMLElement>): void {
  const target = event.target as HTMLElement;
  if (!target.hasAttribute('data-grid-cell')) return;
  const cells = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-grid-cell]')];
  const index = cells.indexOf(target);
  if (index < 0) return;
  let next: HTMLElement | undefined;
  switch (event.key) {
    case 'ArrowRight':
      next = cells[index + 1];
      break;
    case 'ArrowLeft':
      next = cells[index - 1];
      break;
    case 'Home':
      next = cells[0];
      break;
    case 'End':
      next = cells[cells.length - 1];
      break;
    case 'ArrowDown':
    case 'ArrowUp': {
      const down = event.key === 'ArrowDown';
      const rows = cells.filter((c) =>
        down ? c.offsetTop > target.offsetTop : c.offsetTop < target.offsetTop,
      );
      if (!rows.length) break;
      const rowTop = down
        ? Math.min(...rows.map((c) => c.offsetTop))
        : Math.max(...rows.map((c) => c.offsetTop));
      next = rows
        .filter((c) => c.offsetTop === rowTop)
        .sort(
          (a, b) =>
            Math.abs(a.offsetLeft - target.offsetLeft) - Math.abs(b.offsetLeft - target.offsetLeft),
        )[0];
      break;
    }
    default:
      return;
  }
  event.preventDefault();
  next?.focus();
}
