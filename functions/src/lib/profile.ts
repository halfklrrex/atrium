import {
  memberProfileOf,
  type Birthday,
  type SetMyProfileResult,
  type UserProfileWrite,
} from '@atrium/shared';

/** The part of a profile that members see, without the server timestamp. */
export interface SharedProfileFields {
  title: string | null;
  about: string | null;
  location: string | null;
  birthday: Birthday | null;
  timeZone: string | null;
}

/**
 * Storage behind `setMyProfile`, so the rules of what is copied where can be unit tested with an
 * in-memory fake. `adminProfileStore` adapts Firestore. `updatedAt` is the store's job (a server
 * timestamp), so the logic here never sees it.
 */
export interface ProfileStore {
  /** `users/{uid}`: the saved profile (null when never saved) and the time zone. */
  getUserProfileSource(
    uid: string,
  ): Promise<{ profile: UserProfileWrite | null; timezone: string | null }>;
  /** Writes `users/{uid}.profile`. */
  setUserProfile(uid: string, profile: UserProfileWrite): Promise<void>;
  /** Ids of the workspaces the user belongs to (at most `limit`, all when omitted). */
  listWorkspaceIds(uid: string, limit?: number): Promise<string[]>;
  /** The member doc's shared profile; `exists: false` when the member doc is missing. */
  getMemberProfile(
    workspaceId: string,
    uid: string,
  ): Promise<{ exists: boolean; profile: SharedProfileFields | null }>;
  /**
   * Writes the shared profile on the member docs of these workspaces, skipping any whose member
   * doc is missing (they heal on the next `bootstrapUser`). Returns how many were written.
   */
  setMemberProfiles(
    workspaceIds: string[],
    uid: string,
    profile: SharedProfileFields,
  ): Promise<number>;
}

/** Workspaces per batch (a Firestore batch holds 500 writes). */
export const PROFILE_BATCH_SIZE = 400;
/** `bootstrapUser` heals at most this many workspaces, like the name and photo sync. */
export const PROFILE_SYNC_LIMIT = 20;

export function sharedFieldsOf(
  profile: UserProfileWrite,
  timezone: string | null,
): SharedProfileFields {
  const { updatedAt: _updatedAt, ...shared } = memberProfileOf(
    { ...profile, updatedAt: 0 },
    timezone,
  );
  return shared;
}

const sameShared = (a: SharedProfileFields | null, b: SharedProfileFields): boolean =>
  a !== null &&
  a.title === b.title &&
  a.about === b.about &&
  a.location === b.location &&
  a.timeZone === b.timeZone &&
  a.birthday?.month === b.birthday?.month &&
  a.birthday?.day === b.birthday?.day;

/** `setMyProfile`: saves the profile and copies the shared part to every workspace the person is in. */
export async function saveMyProfile(
  store: ProfileStore,
  uid: string,
  profile: UserProfileWrite,
): Promise<SetMyProfileResult> {
  const { timezone } = await store.getUserProfileSource(uid);
  await store.setUserProfile(uid, profile);
  const shared = sharedFieldsOf(profile, timezone);
  const workspaceIds = await store.listWorkspaceIds(uid);
  let written = 0;
  for (let i = 0; i < workspaceIds.length; i += PROFILE_BATCH_SIZE) {
    written += await store.setMemberProfiles(
      workspaceIds.slice(i, i + PROFILE_BATCH_SIZE),
      uid,
      shared,
    );
  }
  return { workspaces: written };
}

/**
 * Self-heal for the member-doc writers (`bootstrapUser`, `acceptInvite`, `createInvite`): copies the
 * saved profile onto the member docs of these workspaces when they differ. Does nothing when the
 * person never saved a profile. Returns how many member docs were written.
 */
export async function syncProfileToWorkspaces(
  store: ProfileStore,
  uid: string,
  workspaceIds: string[],
): Promise<number> {
  if (workspaceIds.length === 0) return 0;
  const { profile, timezone } = await store.getUserProfileSource(uid);
  if (!profile) return 0;
  const shared = sharedFieldsOf(profile, timezone);
  const stale: string[] = [];
  for (const workspaceId of workspaceIds) {
    const current = await store.getMemberProfile(workspaceId, uid);
    if (current.exists && !sameShared(current.profile, shared)) stale.push(workspaceId);
  }
  if (stale.length === 0) return 0;
  return store.setMemberProfiles(stale, uid, shared);
}

/** `bootstrapUser`: heals the caller's member docs (up to `PROFILE_SYNC_LIMIT` workspaces). */
export async function syncProfileOnSignIn(store: ProfileStore, uid: string): Promise<number> {
  return syncProfileToWorkspaces(store, uid, await store.listWorkspaceIds(uid, PROFILE_SYNC_LIMIT));
}
