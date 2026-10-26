# P2: Simple column types (tags, rating, vote, colour, country, location, email, phone)

Author: Antigravity · Implementer: Antigravity · Status: Ready / Built  
Roadmap epic: P2 "Tags, rating, vote, colour, country, location, email, phone" (ID: 3306219469)

## 1. Overview & Data Shapes

These 8 column types expand Atrium's column registry with standard monday-compatible data shapes, schemas, plain-text serializers (`toText`), and sort comparators (`compare`).

All schemas conform to `ColumnType<Settings, Value>` in `packages/shared/src/columns/types.ts` and are registered in `columnRegistry` via `packages/shared/src/columns/index.ts`.

### 1.1 `tags` (Tags)

- **Type identifier:** `tags`
- **Label:** `Tags`
- **Settings schema:**
  ```ts
  z.object({
    tags: z
      .array(
        z.object({
          id: z.number().int(),
          name: z.string().min(1).max(100),
          color: z.string().optional(),
        }),
      )
      .default([]),
  }).strict();
  ```
- **Value schema:**
  ```ts
  z.object({
    tag_ids: z.array(z.number().int()).max(200),
  }).strict();
  ```
- **Plain-text representation:** Comma-separated tag names looked up from settings (fallback to numeric ID); empty string if `tag_ids` is empty.
- **Comparator:** Alphabetical by rendered tag names.
- **Summaries:** `count`, `count_filled`, `count_empty`, `percent_filled`.

### 1.2 `rating` (Rating)

- **Type identifier:** `rating`
- **Label:** `Rating`
- **Settings schema:**
  ```ts
  z.object({
    limit: z.number().int().min(3).max(10).default(5),
    symbol: z.enum(['stars', 'hearts']).default('stars'),
  }).strict();
  ```
- **Value schema:** `{ rating: number }` (0 to 10 integer, strict object)
- **Validation helper:** `isRatingWithinLimit(value, settings): boolean` validates that `value.rating <= settings.limit`.
- **Plain-text representation:** Numeric string (e.g. `"4"`).
- **Comparator:** Numerical order.
- **Summaries:** `count`, `count_filled`, `count_empty`, `percent_filled`, `average`, `min`, `max`, `sum`.

### 1.3 `vote` (Vote)

- **Type identifier:** `vote`
- **Label:** `Vote`
- **Settings schema:** `{}` (strict object)
- **Value schema:**
  ```ts
  z.object({
    votersIds: z
      .array(z.string().min(1).max(128))
      .max(1000)
      .refine((ids) => new Set(ids).size === ids.length),
  }).strict();
  ```
- **Plain-text representation:** Total count as string (`String(value.votersIds.length)`).
- **Comparator:** Numerical order by voter count.
- **Summaries:** `count`, `count_filled`, `count_empty`, `percent_filled`, `sum`, `average`, `min`, `max`.

### 1.4 `color_picker` (Color Picker)

- **Type identifier:** `color_picker`
- **Label:** `Color Picker`
- **Settings schema:** `{}` (strict object)
- **Value schema:**
  ```ts
  z.object({
    color: z
      .object({
        hex: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/),
      })
      .strict(),
  }).strict();
  ```
- **Plain-text representation:** Uppercase HEX code (e.g. `"#FF5733"`).
- **Comparator:** Lexicographical order by uppercase hex code.
- **Summaries:** `count`, `count_filled`, `count_empty`, `percent_filled`.

### 1.5 `country` (Country)

- **Type identifier:** `country`
- **Label:** `Country`
- **Settings schema:** `{}` (strict object)
- **Value schema:** `{ countryCode: string, countryName?: string }` (strict object, 2-letter uppercase ISO code).
- **Plain-text representation:** Country name if available, fallback to 2-letter ISO code.
- **Comparator:** Alphabetical by country name (or code).
- **Summaries:** `count`, `count_filled`, `count_empty`, `percent_filled`.

### 1.6 `location` (Location)

- **Type identifier:** `location`
- **Label:** `Location`
- **Settings schema:** `{}` (strict object)
- **Value schema:**
  ```ts
  z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    address: z.string().max(500).optional(),
  }).strict();
  ```
- **Plain-text representation:** Address if provided, fallback to `"${lat}, ${lng}"`.
- **Comparator:** Alphabetical by address or coordinates.
- **Summaries:** `count`, `count_filled`, `count_empty`, `percent_filled`.

### 1.7 `email` (Email)

- **Type identifier:** `email`
- **Label:** `Email`
- **Settings schema:** `{}` (strict object)
- **Value schema:** `{ email: string, text?: string }` (strict object, validated using `z.email()`).
- **Plain-text representation:** `"Text <email>"` when text is provided, or `"email"` alone.
- **Comparator:** Alphabetical by label text or email.
- **Summaries:** `count`, `count_filled`, `count_empty`, `percent_filled`.

### 1.8 `phone` (Phone)

- **Type identifier:** `phone`
- **Label:** `Phone`
- **Settings schema:** `{}` (strict object)
- **Value schema:** `{ phone: string, countryShortName?: string }` (strict object, requiring at least 5 digits in `phone`).
- **Plain-text representation:** Phone string (e.g. `"+1 202 555 0169"`).
- **Comparator:** Numeric string comparison (`localeCompare(..., { numeric: true })`).
- **Summaries:** `count`, `count_filled`, `count_empty`, `percent_filled`.

## 2. Test Coverage

All schemas, serialization, and sorting logic are covered in `packages/shared/src/columns/simple-columns.test.ts` and integration-tested via `packages/shared/src/columns/registry.test.ts`.
