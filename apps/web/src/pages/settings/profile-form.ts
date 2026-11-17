import {
  PROFILE_LIMITS,
  userProfileWriteSchema,
  type UserProfile,
  type UserProfileWrite,
} from '@atrium/shared';

/** The "About you" form as the inputs hold it (strings, so a field can be half filled in). */
export interface ProfileForm {
  title: string;
  about: string;
  location: string;
  /** "1" to "12", or "" for none. */
  month: string;
  /** "1" to "31", or "" for none. */
  day: string;
  showLocalTime: boolean;
}

export const EMPTY_PROFILE_FORM: ProfileForm = {
  title: '',
  about: '',
  location: '',
  month: '',
  day: '',
  showLocalTime: false,
};

/** The form for a saved profile (`undefined` when the person never filled it in). */
export function formFromProfile(
  profile:
    | Pick<UserProfile, 'title' | 'about' | 'location' | 'birthday' | 'showLocalTime'>
    | null
    | undefined,
): ProfileForm {
  if (!profile) return EMPTY_PROFILE_FORM;
  return {
    title: profile.title ?? '',
    about: profile.about ?? '',
    location: profile.location ?? '',
    month: profile.birthday ? String(profile.birthday.month) : '',
    day: profile.birthday ? String(profile.birthday.day) : '',
    showLocalTime: profile.showLocalTime,
  };
}

/** The request for a saved profile (used to re-send it when the time zone changes). */
export function writeFromProfile(
  profile: Pick<UserProfile, 'title' | 'about' | 'location' | 'birthday' | 'showLocalTime'>,
): UserProfileWrite {
  return {
    title: profile.title,
    about: profile.about,
    location: profile.location,
    birthday: profile.birthday
      ? { month: profile.birthday.month, day: profile.birthday.day }
      : null,
    showLocalTime: profile.showLocalTime,
  };
}

export type ProfileFormResult =
  { ok: true; value: UserProfileWrite } | { ok: false; message: string };

/** Validates the form with the same schema the callable uses and returns a human message. */
export function parseProfileForm(form: ProfileForm): ProfileFormResult {
  if (Boolean(form.month) !== Boolean(form.day)) {
    return { ok: false, message: 'Pick both a month and a day, or clear the birthday.' };
  }
  const parsed = userProfileWriteSchema.safeParse({
    title: form.title,
    about: form.about,
    location: form.location,
    birthday: form.month ? { month: Number(form.month), day: Number(form.day) } : null,
    showLocalTime: form.showLocalTime,
  });
  if (parsed.success) return { ok: true, value: parsed.data };
  const path = parsed.error.issues[0]?.path[0];
  if (path === 'birthday') return { ok: false, message: "That day doesn't exist in that month." };
  const limit =
    path === 'title' || path === 'about' || path === 'location' ? PROFILE_LIMITS[path] : null;
  return {
    ok: false,
    message: limit
      ? `The ${String(path)} can be at most ${limit} characters.`
      : 'Check your entries.',
  };
}

/** True when the form says the same as the saved profile (after trimming). */
export function sameProfile(a: ProfileForm, b: ProfileForm): boolean {
  return (
    a.title.trim() === b.title.trim() &&
    a.about.trim() === b.about.trim() &&
    a.location.trim() === b.location.trim() &&
    a.month === b.month &&
    a.day === b.day &&
    a.showLocalTime === b.showLocalTime
  );
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
