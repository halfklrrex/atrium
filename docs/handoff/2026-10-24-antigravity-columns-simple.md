# 2026-10-24 · Antigravity · P2 Simple Columns Set

## Done

- Implemented 8 simple monday-compatible column types in `packages/shared/src/columns/`:
  - `tags.ts`: monday `tag` column type (`tag_ids` or `tags` with `id`/`name`), comma-separated plain text, alphabetical sorting.
  - `rating.ts`: monday `rating` column type (0-10 rating, configurable `max` in settings, default 5), numeric comparison.
  - `vote.ts`: monday `vote` column type (supports `voter_ids`, `voters`, or `vote_count`), count serialization, vote count comparison.
  - `color.ts`: monday `color_picker` column type plus `color` alias, hex string validation (3, 6, 8 hex digits), uppercase plain text.
  - `country.ts`: monday `country` column type (supports flat `countryCode`/`countryName` and nested `country: { code, name }`), name/code display.
  - `location.ts`: monday `location` column type (numeric/string `lat`, `lng`, and optional `address`), formatted address or coordinate output.
  - `email.ts`: monday `email` column type (validated email address and optional display `text`), formatted text output.
  - `phone.ts`: monday `phone` column type (international phone number and optional `countryShortName`).
- Registered all 8 columns in `columnRegistry` via `packages/shared/src/columns/index.ts`.
- Added unit test suite `packages/shared/src/columns/simple-columns.test.ts` (19 tests) covering schemas, settings, serializers, and comparators.
- Updated `packages/shared/src/columns/registry.test.ts` to assert inclusion of all new types.
- All checks pass: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm build`.

## Gotchas

- monday API uses `tag` for tags column type, and `color_picker` for colour column type. Both `color_picker` and `color` are registered for convenience.
- Vote column in monday API can return `voter_ids` array or `vote_count`; the schema and `getVoteCount` helper accommodate both safely.

## Next

- Move to next assigned P2 task: `Progress, auto number, item ID, creation log, last updated` (Roadmap ID: `3306218928`).
