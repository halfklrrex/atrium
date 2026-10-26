// Stylelint: enforces AGENTS.md "Use tokens only". Colours, spacing, radius, shadow and typography
// come from Vibe CSS variables or apps/web/src/theme/*.css. Details and allow-list policy:
// docs/specs/VF4-design-tokens-audit.md.

const COLOR_FUNCTIONS = ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch'];
const RAW_LENGTH_UNITS = ['px', 'rem', 'em'];

/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '.claude/worktrees/**'],
  // Every allow-list comment must say why, and stale ones must be removed.
  reportDescriptionlessDisables: true,
  reportNeedlessDisables: true,
  reportInvalidScopeDisables: true,
  rules: {
    // ---- Token enforcement ------------------------------------------------------------------
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': COLOR_FUNCTIONS,
    // Raw lengths are banned for spacing, radius, type and shadow. Layout sizes (width, height,
    // top, inset, ...) and 1px borders/outlines are not covered; use a token where one exists.
    'declaration-property-unit-disallowed-list': {
      '/^(margin|padding)(-|$)/': RAW_LENGTH_UNITS,
      '/^(gap|row-gap|column-gap)$/': RAW_LENGTH_UNITS,
      '/^border(-[a-z]+)*-radius$/': RAW_LENGTH_UNITS,
      'font-size': RAW_LENGTH_UNITS,
      'line-height': RAW_LENGTH_UNITS,
      font: RAW_LENGTH_UNITS,
      'letter-spacing': RAW_LENGTH_UNITS,
      'box-shadow': RAW_LENGTH_UNITS,
      'text-shadow': RAW_LENGTH_UNITS,
    },
    // Font weights and families come from Vibe (`--font-weight-*`, `--font-family`,
    // `--title-font-family`) or an `--atrium-*-font` shorthand token, never a literal.
    'declaration-property-value-disallowed-list': {
      'font-weight': ['/^\\d+$/', '/^(normal|bold|bolder|lighter)$/'],
      'font-family': ['/^(?!var\\()/'],
    },

    // ---- Standard-config rules that are style opinions, not token rules ----------------------
    // Prettier owns formatting; these would only churn existing, working CSS.
    'selector-class-pattern': null, // CSS-module class names are camelCase, `:global()` ones kebab
    'keyframes-name-pattern': null, // CSS-module keyframes are camelCase
    'custom-property-pattern': null, // `--color-egg_yolk` mirrors Vibe's own token names
    'custom-property-empty-line-before': null,
    'no-descending-specificity': null, // reordering rules risks visual changes
    'media-feature-range-notation': null,
    'declaration-block-no-redundant-longhand-properties': null,
    'color-function-notation': null,
    'color-function-alias-notation': null,
    'alpha-value-notation': null,
    'color-hex-length': null,
    'value-keyword-case': null,

    // ---- CSS modules ------------------------------------------------------------------------
    'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global', 'local'] }],
    'property-no-unknown': [true, { ignoreProperties: ['composes'] }],
  },
  overrides: [
    {
      // The ONLY place for literal colours, lengths and shadows: the token definitions.
      files: ['apps/web/src/theme/*.css'],
      rules: {
        'color-no-hex': null,
        'function-disallowed-list': null,
        'declaration-property-unit-disallowed-list': null,
        'declaration-property-value-disallowed-list': null,
      },
    },
  ],
};
