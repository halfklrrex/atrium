import { describe, expect, it } from 'vitest';
import {
  colorPickerColumn,
  columnRegistry,
  countryColumn,
  emailColumn,
  isRatingWithinLimit,
  locationColumn,
  phoneColumn,
  ratingColumn,
  tagsColumn,
  voteColumn,
} from './index';

describe('tags column', () => {
  const settings = {
    tags: [
      { id: 1, name: 'Urgent', color: '#ff0000' },
      { id: 2, name: 'Frontend', color: '#00ff00' },
    ],
  };

  it('validates settings and rejects unknown keys', () => {
    expect(tagsColumn.settingsSchema.safeParse(settings).success).toBe(true);
    expect(tagsColumn.settingsSchema.safeParse({ tags: [], extra: 1 }).success).toBe(false);
  });

  it('accepts valid tag_ids including empty array', () => {
    expect(tagsColumn.valueSchema.safeParse({ tag_ids: [1, 2] }).success).toBe(true);
    expect(tagsColumn.valueSchema.safeParse({ tag_ids: [] }).success).toBe(true);
    expect(tagsColumn.valueSchema.safeParse({}).success).toBe(false);
    expect(tagsColumn.valueSchema.safeParse({ tag_ids: ['invalid'] }).success).toBe(false);
  });

  it('renders tag names from settings and handles missing tag names', () => {
    expect(tagsColumn.toText({ tag_ids: [1, 2] }, settings)).toBe('Urgent, Frontend');
    expect(tagsColumn.toText({ tag_ids: [1, 99] }, settings)).toBe('Urgent, 99');
    expect(tagsColumn.toText({ tag_ids: [] }, settings)).toBe('');
  });

  it('sorts alphabetically by rendered label', () => {
    const valA = { tag_ids: [2] }; // 'Frontend'
    const valB = { tag_ids: [1] }; // 'Urgent'
    expect(tagsColumn.compare(valA, valB, settings)).toBeLessThan(0);
  });

  it('round-trips through registry parseValue and toText', () => {
    const parsed = columnRegistry.parseValue('tags', { tag_ids: [1] });
    expect(parsed).toEqual({ success: true, data: { tag_ids: [1] } });
    if (parsed.success) {
      expect(columnRegistry.toText('tags', parsed.data, settings)).toBe('Urgent');
    }
  });
});

describe('color_picker column', () => {
  const settings = colorPickerColumn.defaultSettings();

  it('validates settings and rejects unknown keys', () => {
    expect(colorPickerColumn.settingsSchema.safeParse({}).success).toBe(true);
    expect(colorPickerColumn.settingsSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it('requires canonical { color: { hex } } and rejects legacy bare string', () => {
    expect(colorPickerColumn.valueSchema.safeParse({ color: { hex: '#FF5733' } }).success).toBe(
      true,
    );
    expect(colorPickerColumn.valueSchema.safeParse({ color: '#FF5733' }).success).toBe(false);
    expect(colorPickerColumn.valueSchema.safeParse({ color: { hex: 'not-a-color' } }).success).toBe(
      false,
    );
  });

  it('renders uppercase hex and compares values', () => {
    const val1 = { color: { hex: '#ff5733' } };
    const val2 = { color: { hex: '#00AAFF' } };
    expect(colorPickerColumn.toText(val1, settings)).toBe('#FF5733');
    expect(colorPickerColumn.compare(val2, val1, settings)).toBeLessThan(0);
  });

  it('round-trips through registry parseValue and toText', () => {
    const parsed = columnRegistry.parseValue('color_picker', { color: { hex: '#123456' } });
    expect(parsed).toEqual({ success: true, data: { color: { hex: '#123456' } } });
    if (parsed.success) {
      expect(columnRegistry.toText('color_picker', parsed.data, {})).toBe('#123456');
    }
  });
});

describe('vote column', () => {
  const settings = voteColumn.defaultSettings();

  it('validates settings and rejects unknown keys', () => {
    expect(voteColumn.settingsSchema.safeParse({}).success).toBe(true);
    expect(voteColumn.settingsSchema.safeParse({ foo: 'bar' }).success).toBe(false);
  });

  it('accepts unique votersIds and rejects duplicates or legacy shapes', () => {
    expect(voteColumn.valueSchema.safeParse({ votersIds: ['uid1', 'uid2'] }).success).toBe(true);
    expect(voteColumn.valueSchema.safeParse({ votersIds: ['uid1', 'uid1'] }).success).toBe(false);
    expect(voteColumn.valueSchema.safeParse({ voter_ids: ['uid1'] }).success).toBe(false);
    expect(voteColumn.valueSchema.safeParse({ vote_count: 5 }).success).toBe(false);
  });

  it('toText returns voter count and compare sorts numerically by count', () => {
    const val1 = { votersIds: ['u1', 'u2'] };
    const val2 = { votersIds: ['u3'] };
    expect(voteColumn.toText(val1, settings)).toBe('2');
    expect(voteColumn.compare(val2, val1, settings)).toBeLessThan(0);
  });

  it('round-trips through registry parseValue and toText', () => {
    const parsed = columnRegistry.parseValue('vote', { votersIds: ['u1', 'u2', 'u3'] });
    expect(parsed).toEqual({ success: true, data: { votersIds: ['u1', 'u2', 'u3'] } });
    if (parsed.success) {
      expect(columnRegistry.toText('vote', parsed.data, {})).toBe('3');
    }
  });
});

describe('rating column', () => {
  const settings = { limit: 5, symbol: 'stars' as const };

  it('validates settings limit range (3..10) and symbol, rejecting unknown keys', () => {
    expect(ratingColumn.settingsSchema.safeParse({ limit: 5, symbol: 'stars' }).success).toBe(true);
    expect(ratingColumn.settingsSchema.safeParse({ limit: 10, symbol: 'hearts' }).success).toBe(
      true,
    );
    expect(ratingColumn.settingsSchema.safeParse({ limit: 2 }).success).toBe(false);
    expect(ratingColumn.settingsSchema.safeParse({ limit: 11 }).success).toBe(false);
    expect(ratingColumn.settingsSchema.safeParse({ limit: 5, unknown: true }).success).toBe(false);
  });

  it('validates rating values 0..10', () => {
    expect(ratingColumn.valueSchema.safeParse({ rating: 0 }).success).toBe(true);
    expect(ratingColumn.valueSchema.safeParse({ rating: 10 }).success).toBe(true);
    expect(ratingColumn.valueSchema.safeParse({ rating: -1 }).success).toBe(false);
    expect(ratingColumn.valueSchema.safeParse({ rating: 11 }).success).toBe(false);
  });

  it('checks rating against settings limit via isRatingWithinLimit', () => {
    expect(isRatingWithinLimit({ rating: 4 }, settings)).toBe(true);
    expect(isRatingWithinLimit({ rating: 5 }, settings)).toBe(true);
    expect(isRatingWithinLimit({ rating: 6 }, settings)).toBe(false);
  });

  it('toText returns rating number and compare sorts numerically', () => {
    const r3 = { rating: 3 };
    const r5 = { rating: 5 };
    expect(ratingColumn.toText(r3, settings)).toBe('3');
    expect(ratingColumn.compare(r3, r5, settings)).toBeLessThan(0);
  });

  it('round-trips through registry parseValue and toText', () => {
    const parsed = columnRegistry.parseValue('rating', { rating: 4 });
    expect(parsed).toEqual({ success: true, data: { rating: 4 } });
    if (parsed.success) {
      expect(columnRegistry.toText('rating', parsed.data, settings)).toBe('4');
    }
  });
});

describe('country column', () => {
  const settings = countryColumn.defaultSettings();

  it('validates settings and rejects unknown keys', () => {
    expect(countryColumn.settingsSchema.safeParse({}).success).toBe(true);
    expect(countryColumn.settingsSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it('accepts countryCode and optional countryName, rejecting nested forms', () => {
    expect(
      countryColumn.valueSchema.safeParse({ countryCode: 'US', countryName: 'United States' })
        .success,
    ).toBe(true);
    expect(countryColumn.valueSchema.safeParse({ countryCode: 'CA' }).success).toBe(true);
    expect(countryColumn.valueSchema.safeParse({ country: { code: 'US' } }).success).toBe(false);
    expect(countryColumn.valueSchema.safeParse({ countryCode: 'USA' }).success).toBe(false);
  });

  it('toText falls back from countryName to countryCode and compares alphabetically', () => {
    const us = { countryCode: 'US', countryName: 'United States' };
    const de = { countryCode: 'DE' };
    expect(countryColumn.toText(us, settings)).toBe('United States');
    expect(countryColumn.toText(de, settings)).toBe('DE');
    expect(countryColumn.compare(de, us, settings)).toBeLessThan(0);
  });

  it('round-trips through registry parseValue and toText', () => {
    const parsed = columnRegistry.parseValue('country', {
      countryCode: 'GB',
      countryName: 'United Kingdom',
    });
    expect(parsed).toEqual({
      success: true,
      data: { countryCode: 'GB', countryName: 'United Kingdom' },
    });
    if (parsed.success) {
      expect(columnRegistry.toText('country', parsed.data, {})).toBe('United Kingdom');
    }
  });
});

describe('location column', () => {
  const settings = locationColumn.defaultSettings();

  it('validates settings and rejects unknown keys', () => {
    expect(locationColumn.settingsSchema.safeParse({}).success).toBe(true);
    expect(locationColumn.settingsSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it('enforces latitude (-90..90) and longitude (-180..180) bounds as numbers', () => {
    expect(
      locationColumn.valueSchema.safeParse({ lat: 40.7128, lng: -74.006, address: 'New York' })
        .success,
    ).toBe(true);
    expect(locationColumn.valueSchema.safeParse({ lat: 90, lng: 180 }).success).toBe(true);
    expect(locationColumn.valueSchema.safeParse({ lat: -90, lng: -180 }).success).toBe(true);
    // Out of bounds
    expect(locationColumn.valueSchema.safeParse({ lat: 90.1, lng: 0 }).success).toBe(false);
    expect(locationColumn.valueSchema.safeParse({ lat: -90.1, lng: 0 }).success).toBe(false);
    expect(locationColumn.valueSchema.safeParse({ lat: 0, lng: 180.1 }).success).toBe(false);
    expect(locationColumn.valueSchema.safeParse({ lat: 0, lng: -180.1 }).success).toBe(false);
    // Rejects strings
    expect(locationColumn.valueSchema.safeParse({ lat: '40.7', lng: '-74.0' }).success).toBe(false);
  });

  it('toText renders address or lat/lng and compares alphabetically', () => {
    const locWithAddr = { lat: 40.7, lng: -74.0, address: 'NYC' };
    const locNoAddr = { lat: 51.5, lng: -0.1 };
    expect(locationColumn.toText(locWithAddr, settings)).toBe('NYC');
    expect(locationColumn.toText(locNoAddr, settings)).toBe('51.5, -0.1');
    expect(locationColumn.compare(locWithAddr, locNoAddr, settings)).toBeGreaterThan(0);
  });

  it('round-trips through registry parseValue and toText', () => {
    const parsed = columnRegistry.parseValue('location', {
      lat: 48.8566,
      lng: 2.3522,
      address: 'Paris',
    });
    expect(parsed).toEqual({
      success: true,
      data: { lat: 48.8566, lng: 2.3522, address: 'Paris' },
    });
    if (parsed.success) {
      expect(columnRegistry.toText('location', parsed.data, {})).toBe('Paris');
    }
  });
});

describe('email column', () => {
  const settings = emailColumn.defaultSettings();

  it('validates settings and rejects unknown keys', () => {
    expect(emailColumn.settingsSchema.safeParse({}).success).toBe(true);
    expect(emailColumn.settingsSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it('validates email addresses with optional display text', () => {
    expect(
      emailColumn.valueSchema.safeParse({ email: 'avery@example.com', text: 'Avery' }).success,
    ).toBe(true);
    expect(emailColumn.valueSchema.safeParse({ email: 'avery@example.com' }).success).toBe(true);
    expect(emailColumn.valueSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  it('toText formats display text and compares correctly', () => {
    const withText = { email: 'alice@example.com', text: 'Alice' };
    const bare = { email: 'bob@example.com' };
    expect(emailColumn.toText(withText, settings)).toBe('Alice <alice@example.com>');
    expect(emailColumn.toText(bare, settings)).toBe('bob@example.com');
    expect(emailColumn.compare(withText, bare, settings)).toBeLessThan(0);
  });

  it('round-trips through registry parseValue and toText', () => {
    const parsed = columnRegistry.parseValue('email', { email: 'dev@atrium.local' });
    expect(parsed).toEqual({ success: true, data: { email: 'dev@atrium.local' } });
    if (parsed.success) {
      expect(columnRegistry.toText('email', parsed.data, {})).toBe('dev@atrium.local');
    }
  });
});

describe('phone column', () => {
  const settings = phoneColumn.defaultSettings();

  it('validates settings and rejects unknown keys', () => {
    expect(phoneColumn.settingsSchema.safeParse({}).success).toBe(true);
    expect(phoneColumn.settingsSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it('requires at least 5 digits in phone string and allows countryShortName', () => {
    expect(
      phoneColumn.valueSchema.safeParse({ phone: '+44 7700 900123', countryShortName: 'GB' })
        .success,
    ).toBe(true);
    expect(phoneColumn.valueSchema.safeParse({ phone: '12345' }).success).toBe(true);
    // Less than 5 digits or digit-less
    expect(phoneColumn.valueSchema.safeParse({ phone: '1234' }).success).toBe(false);
    expect(phoneColumn.valueSchema.safeParse({ phone: '+---()' }).success).toBe(false);
  });

  it('compares phones numerically', () => {
    const p1 = { phone: '+1 200' };
    const p2 = { phone: '+1 1000' };
    expect(phoneColumn.compare(p1, p2, settings)).toBeLessThan(0);
  });

  it('round-trips through registry parseValue and toText', () => {
    const parsed = columnRegistry.parseValue('phone', { phone: '+1 800 555 0199' });
    expect(parsed).toEqual({ success: true, data: { phone: '+1 800 555 0199' } });
    if (parsed.success) {
      expect(columnRegistry.toText('phone', parsed.data, {})).toBe('+1 800 555 0199');
    }
  });
});
