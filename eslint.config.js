import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'functions/lib/**',
      '**/coverage/**',
      '.emulator-data/**',
      '.firebase/**',
      'pnpm-lock.yaml',
      '.claude/worktrees/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,js,mjs,mts}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // Browser app
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Design tokens (AGENTS.md "Use tokens only"): no colour or raw length literals in TSX styling.
  // CSS is covered by Stylelint. Use `var(--token)`; the persisted colour palette lives in
  // theme/palette.ts. To allow a genuine exception (e.g. a third-party brand colour), use a
  // targeted `// eslint-disable-next-line no-restricted-syntax -- <reason>` comment.
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', 'apps/web/src/test/**', 'apps/web/src/theme/palette.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXAttribute[name.name='style'] Literal[value=/^\\s*(#[0-9a-fA-F]{3,8}|(rgb|hsl)a?\\()/]",
          message: 'Colour literal in a style prop. Use a Vibe or --atrium-* CSS variable.',
        },
        {
          selector:
            "JSXAttribute[name.name='style'] TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b|(rgb|hsl)a?\\(/]",
          message: 'Colour literal in a style prop. Use a Vibe or --atrium-* CSS variable.',
        },
        {
          selector:
            "JSXAttribute[name.name='style'] Property[key.name=/^(color|background|backgroundColor|borderColor|outlineColor|fill|stroke|caretColor|accentColor)$/] > Literal[value=/^(?!var\\(|#|(rgb|hsl)a?\\(|inherit$|initial$|unset$|none$|transparent$|currentColor$)/i]",
          message: 'Named colour in a style prop. Use a Vibe or --atrium-* CSS variable.',
        },
        {
          selector:
            'JSXAttribute[name.name=/^(fill|stroke|stopColor|floodColor|lightingColor)$/] > Literal[value=/^\\s*(#[0-9a-fA-F]{3,8}|(rgb|hsl)a?\\()/]',
          message: 'Colour literal in an SVG attribute. Use var(--token).',
        },
        {
          selector:
            "JSXAttribute[name.name='style'] Property > Literal[value=/^-?[0-9.]+(px|rem|em)$/]",
          message:
            'Raw px/rem/em length in a style prop. Use a Vibe --space-* or --atrium-* token.',
        },
        {
          selector:
            "JSXAttribute[name.name='style'] Property[key.name='zIndex'] > Literal[raw=/^-?[0-9]+$/]",
          message: 'Numeric zIndex in a style prop. Use var(--atrium-z-*) from theme/tokens.css.',
        },
        {
          selector: "JSXAttribute[name.name='zIndex']",
          message:
            'Do not set zIndex on Vibe components. Floating layers get --atrium-z-dropdown from index.css.',
        },
      ],
    },
  },

  // Column UI modules export a registration object next to the cell and editor components they
  // define; they are loaded once at start-up, so fast refresh does not apply to them.
  {
    files: ['apps/web/src/columns/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  // Node: functions, rules tests, scripts and tool configs
  {
    files: [
      'functions/**/*.{ts,mts}',
      'tests/**/*.ts',
      'scripts/**/*.mjs',
      '*.config.{js,ts}',
      '**/vite.config.ts',
      '**/vitest.config.{ts,mts}',
    ],
    languageOptions: { globals: globals.node },
  },
);
