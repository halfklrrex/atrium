import { z } from 'zod';
import { defineColumnType } from './registry';

export const locationSettingsSchema = z.object({}).strict();
export type LocationSettings = z.infer<typeof locationSettingsSchema>;

/**
 * monday location column value:
 * `{"lat": 40.7128, "lng": -74.0060, "address": "New York, NY"}`
 * Latitude must be within -90..90, Longitude must be within -180..180.
 */
export const locationValueSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    address: z.string().max(500).optional(),
  })
  .strict();
export type LocationValue = z.infer<typeof locationValueSchema>;

export const locationColumn = defineColumnType<LocationSettings, LocationValue>({
  type: 'location',
  label: 'Location',
  settingsSchema: locationSettingsSchema,
  valueSchema: locationValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled'],
  defaultSettings: () => ({}),
  toText: (value) => value.address || `${value.lat}, ${value.lng}`,
  compare: (a, b) => {
    const textA = a.address || `${a.lat}, ${a.lng}`;
    const textB = b.address || `${b.lat}, ${b.lng}`;
    return textA.localeCompare(textB, undefined, { sensitivity: 'base' });
  },
});
