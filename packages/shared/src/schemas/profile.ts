import { z } from 'zod';
import { timestampSchema } from './common';

/** Limits shared by the callable, the web form and the tests (docs/specs/TEAMS-teams-and-profiles.md). */
export const PROFILE_LIMITS = { title: 80, about: 500, location: 80 } as const;

/** Days per month in a leap year, so a 29 February birthday is valid (the year is never stored). */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** A birthday as day and month only. Validated as a real date in a leap year. */
export const birthdaySchema = z
  .object({
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  })
  .strict()
  .refine((b) => b.day <= (DAYS_IN_MONTH[b.month - 1] ?? 0), {
    message: 'Not a real date',
    path: ['day'],
  });
export type Birthday = z.infer<typeof birthdaySchema>;

/** Blank (after trimming) means "not set". */
const optionalText = (max: number) =>
  z
    .string()
    .max(max * 4) // generous pre-trim bound; the exact limit applies after trimming
    .nullable()
    .transform((v) => (v === null ? null : v.trim() || null))
    .pipe(z.string().max(max).nullable());

/** What a person may set (the `setMyProfile` request body): everything optional. */
export const userProfileWriteSchema = z
  .object({
    title: optionalText(PROFILE_LIMITS.title),
    about: optionalText(PROFILE_LIMITS.about),
    location: optionalText(PROFILE_LIMITS.location),
    birthday: birthdaySchema.nullable(),
    showLocalTime: z.boolean(),
  })
  .strict();
export type UserProfileWrite = z.output<typeof userProfileWriteSchema>;
export type UserProfileWriteInput = z.input<typeof userProfileWriteSchema>;

/** `users/{uid}.profile` (self-read only; written by `setMyProfile`). */
export const userProfileSchema = z.object({
  title: z.string().max(PROFILE_LIMITS.title).nullable(),
  about: z.string().max(PROFILE_LIMITS.about).nullable(),
  location: z.string().max(PROFILE_LIMITS.location).nullable(),
  birthday: birthdaySchema.nullable(),
  showLocalTime: z.boolean(),
  updatedAt: timestampSchema,
});
export type UserProfile = z.infer<typeof userProfileSchema>;

/** `workspaces/{ws}/members/{uid}.profile`: the part every workspace member may see. */
export const memberSharedProfileSchema = z.object({
  title: z.string().max(PROFILE_LIMITS.title).nullable(),
  about: z.string().max(PROFILE_LIMITS.about).nullable(),
  location: z.string().max(PROFILE_LIMITS.location).nullable(),
  birthday: birthdaySchema.nullable(),
  /** The person's time zone, only when they chose to show their local time; otherwise `null`. */
  timeZone: z.string().max(64).nullable(),
  updatedAt: timestampSchema,
});
export type MemberProfile = z.infer<typeof memberSharedProfileSchema>;

/** The profile fields of a user doc that `memberProfileOf` needs (`updatedAt` is passed through). */
export interface ProfileSource<T> {
  title: string | null;
  about: string | null;
  location: string | null;
  birthday: Birthday | null;
  showLocalTime: boolean;
  updatedAt: T;
}

/**
 * The shared copy of a profile for member docs: the same fields, with the person's time zone only
 * when they switched on "show my local time". Pure, so every writer agrees.
 */
export function memberProfileOf<T>(
  profile: ProfileSource<T>,
  timezone: string | null | undefined,
): {
  title: string | null;
  about: string | null;
  location: string | null;
  birthday: Birthday | null;
  timeZone: string | null;
  updatedAt: T;
} {
  return {
    title: profile.title,
    about: profile.about,
    location: profile.location,
    birthday: profile.birthday,
    timeZone: profile.showLocalTime && timezone ? timezone : null,
    updatedAt: profile.updatedAt,
  };
}

export const SET_MY_PROFILE_CALLABLE = 'setMyProfile';

/** Request of `setMyProfile`. */
export const setMyProfileRequestSchema = userProfileWriteSchema;
export type SetMyProfileRequest = z.input<typeof setMyProfileRequestSchema>;

/** Result of `setMyProfile`: how many workspaces' member docs were updated. */
export const setMyProfileResultSchema = z.object({ workspaces: z.number().int().min(0) });
export type SetMyProfileResult = z.infer<typeof setMyProfileResultSchema>;
