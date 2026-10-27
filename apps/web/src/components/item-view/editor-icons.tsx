import type { ComponentType } from 'react';

export type EditorIcon = ComponentType<{ 'aria-hidden'?: boolean }>;

/** Vibe has no numbered-list icon: an inline SVG that follows the text colour. */
export function NumberedList() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M2.2 6V3.3l-.9.5-.3-.6 1.3-.8h.7V6zM1 9.5c0-1 .8-1.4 1.5-1.4.9 0 1.4.5 1.4 1.1 0 .5-.3.8-.9 1.3l-.5.4H4v.7H1v-.6l1.3-1.2c.4-.4.6-.5.6-.7 0-.2-.2-.3-.4-.3-.3 0-.4.2-.4.4zM1 14.800h.7c0 .2.2.4.5.4.3 0 .4-.1.4-.3 0-.2-.2-.3-.5-.3h-.3v-.6h.3c.3 0 .4-.1.4-.3 0-.2-.2-.3-.4-.3-.3 0-.4.2-.4.3H1c0-.5.5-.9 1.200-.9.7 0 1.200.4 1.200.8 0 .3-.2.5-.4.6.3.1.5.4.5.7 0 .6-.5 1-1.300 1-.8 0-1.200-.4-1.200-.9z" />
      <path d="M7 4h11v1.500H7zM7 9.250h11v1.500H7zM7 14.500h11V16H7z" />
    </svg>
  );
}

/** Vibe has no strikethrough icon. */
export function Strikethrough() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M2 9.250h16v1.500H2z" />
      <path d="M10.100 3C7.700 3 6.200 4.200 6.200 5.900c0 .8.300 1.400.8 1.900h2.200c-.9-.4-1.300-.8-1.300-1.400 0-.7.700-1.200 2.100-1.200 1 0 1.900.3 2.700.9l.8-1.500C12.600 3.300 11.400 3 10.100 3zM13.400 11.500c.3.400.4.800.4 1.300 0 1.100-1.100 1.800-2.900 1.800-1.200 0-2.300-.4-3.200-1.100l-.8 1.500c1 .8 2.400 1.300 4 1.300 2.700 0 4.500-1.300 4.500-3.300 0-.6-.2-1.100-.4-1.500z" />
    </svg>
  );
}

/** An "A" with a coloured underline; the underline follows `--atrium-current-color`. */
export function TextColorIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M9.100 2.500h1.800l4.600 11h-1.900l-1.100-2.800H7.500L6.400 13.500H4.500l4.600-11zM10 5.200 8.200 9.600h3.600L10 5.200z" />
      <rect
        x="3"
        y="15.500"
        width="14"
        height="2.500"
        rx="1"
        style={{ fill: 'var(--atrium-current-color, var(--primary-color))' }}
      />
    </svg>
  );
}
