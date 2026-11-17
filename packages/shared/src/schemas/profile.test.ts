import { describe, expect, it } from 'vitest';
import {
  PROFILE_LIMITS,
  birthdaySchema,
  memberProfileOf,
  userProfileWriteSchema,
  userSchema,
} from '../index';

const ts = { seconds: 1, nanoseconds: 0, toDate: () => new Date(1000), toMillis: () => 1000 };
const base = { title: null, about: null, location: null, birthday: null, showLocalTime: false };

describe('birthdaySchema', () => {
  it('accepts real dates, including 29 February', () => {
    expect(birthdaySchema.safeParse({ month: 2, day: 29 }).success).toBe(true);
    expect(birthdaySchema.safeParse({ month: 12, day: 31 }).success).toBe(true);
  });
  it('refuses impossible dates and extra keys', () => {
    expect(birthdaySchema.safeParse({ month: 2, day: 30 }).success).toBe(false);
    expect(birthdaySchema.safeParse({ month: 4, day: 31 }).success).toBe(false);
    expect(birthdaySchema.safeParse({ month: 13, day: 1 }).success).toBe(false);
    expect(birthdaySchema.safeParse({ month: 1, day: 0 }).success).toBe(false);
    expect(birthdaySchema.safeParse({ month: 1.5, day: 1 }).success).toBe(false);
    expect(birthdaySchema.safeParse({ month: 1, day: 1, year: 1990 }).success).toBe(false);
  });
});

describe('userProfileWriteSchema', () => {
  it('trims text and turns blank into null', () => {
    const out = userProfileWriteSchema.parse({ ...base, title: '  Mom  ', about: '   ' });
    expect(out.title).toBe('Mom');
    expect(out.about).toBeNull();
  });
  it('refuses text over the limits', () => {
    expect(
      userProfileWriteSchema.safeParse({ ...base, title: 'x'.repeat(PROFILE_LIMITS.title + 1) })
        .success,
    ).toBe(false);
    expect(
      userProfileWriteSchema.safeParse({ ...base, about: 'x'.repeat(PROFILE_LIMITS.about + 1) })
        .success,
    ).toBe(false);
    expect(
      userProfileWriteSchema.safeParse({
        ...base,
        location: 'x'.repeat(PROFILE_LIMITS.location + 1),
      }).success,
    ).toBe(false);
    expect(
      userProfileWriteSchema.safeParse({ ...base, about: 'x'.repeat(PROFILE_LIMITS.about) })
        .success,
    ).toBe(true);
  });
  it('refuses unknown keys such as a phone number, and a bad birthday', () => {
    expect(userProfileWriteSchema.safeParse({ ...base, phone: '123' }).success).toBe(false);
    expect(
      userProfileWriteSchema.safeParse({ ...base, birthday: { month: 2, day: 31 } }).success,
    ).toBe(false);
    expect(userProfileWriteSchema.safeParse({ ...base, showLocalTime: 'yes' }).success).toBe(false);
  });
});

describe('memberProfileOf', () => {
  const profile = { ...base, title: 'Mom', location: 'Lyon', updatedAt: ts };
  it('hides the time zone unless local time is shared', () => {
    expect(memberProfileOf(profile, 'Europe/Paris').timeZone).toBeNull();
    expect(memberProfileOf({ ...profile, showLocalTime: true }, 'Europe/Paris').timeZone).toBe(
      'Europe/Paris',
    );
    expect(memberProfileOf({ ...profile, showLocalTime: true }, null).timeZone).toBeNull();
  });
  it('copies the shared fields only', () => {
    const out = memberProfileOf({ ...profile, showLocalTime: true }, 'UTC');
    expect(Object.keys(out).sort()).toEqual(
      ['about', 'birthday', 'location', 'timeZone', 'title', 'updatedAt'].sort(),
    );
  });
});

describe('userSchema', () => {
  it('accepts an optional profile', () => {
    const user = {
      displayName: 'A',
      email: 'a@example.com',
      photoURL: null,
      timezone: 'UTC',
      locale: 'en',
      lastWorkspaceId: null,
      theme: 'system',
      createdAt: ts,
    };
    expect(userSchema.safeParse(user).success).toBe(true);
    expect(userSchema.safeParse({ ...user, profile: { ...base, updatedAt: ts } }).success).toBe(
      true,
    );
  });
});
