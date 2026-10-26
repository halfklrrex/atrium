import { z } from 'zod';
import { defineColumnType } from './registry';

export const ratingSettingsSchema = z
  .object({
    /** Maximum rating allowed (default is 5). Range 3..10 */
    limit: z.number().int().min(3).max(10).default(5),
    /** Icon symbol: 'stars' or 'hearts' */
    symbol: z.enum(['stars', 'hearts']).default('stars'),
  })
  .strict();
export type RatingSettings = z.infer<typeof ratingSettingsSchema>;

/**
 * monday rating column value: `{"rating": 3}` where rating is an integer between 0 and 10.
 */
export const ratingValueSchema = z
  .object({
    rating: z.number().int().min(0).max(10),
  })
  .strict();
export type RatingValue = z.infer<typeof ratingValueSchema>;

/**
 * Validates that the rating does not exceed the column settings limit.
 */
export function isRatingWithinLimit(value: RatingValue, settings: RatingSettings): boolean {
  return value.rating <= settings.limit;
}

export const ratingColumn = defineColumnType<RatingSettings, RatingValue>({
  type: 'rating',
  label: 'Rating',
  settingsSchema: ratingSettingsSchema,
  valueSchema: ratingValueSchema,
  summaries: [
    'count',
    'count_filled',
    'count_empty',
    'percent_filled',
    'average',
    'min',
    'max',
    'sum',
  ],
  defaultSettings: () => ({ limit: 5, symbol: 'stars' }),
  toText: (value) => String(value.rating),
  compare: (a, b) => a.rating - b.rating,
});
