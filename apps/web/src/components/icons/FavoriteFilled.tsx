import type { SubIcon } from '@vibe/core';

/**
 * Filled star glyph for favorited items.
 *
 * `@vibe/icons` ships only `Favorite`, whose SVG path includes an inner cutout
 * subpath with `clip-rule="evenodd"`. When filled with `currentColor`, it renders
 * only as an outline. `FavoriteFilled` matches the exact outer boundary path of
 * `Favorite` without the cutout, producing a solid filled star.
 */
export const FavoriteFilled: SubIcon = ({ className, size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="currentColor"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <path d="M11.234 3.016a1.379 1.379 0 0 0-2.47 0l-1.78 3.61-3.99.584h-.003a1.376 1.376 0 0 0-.754 2.348v.001l2.878 2.813-.68 3.97v.001a1.376 1.376 0 0 0 2.005 1.45L10 15.921l3.549 1.866a1.377 1.377 0 0 0 2.005-1.45v-.001l-.68-3.97 2.882-2.81v-.001a1.377 1.377 0 0 0-.753-2.348l-3.989-.58-1.78-3.61Z" />
  </svg>
);
