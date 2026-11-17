import type { UserProfileWrite } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import {
  PROFILE_BATCH_SIZE,
  saveMyProfile,
  sharedFieldsOf,
  syncProfileOnSignIn,
  syncProfileToWorkspaces,
  type ProfileStore,
  type SharedProfileFields,
} from './profile';

const profile = (over: Partial<UserProfileWrite> = {}): UserProfileWrite => ({
  title: 'Mom',
  about: 'Hello',
  location: 'Lyon',
  birthday: { month: 3, day: 12 },
  showLocalTime: true,
  ...over,
});

class FakeStore implements ProfileStore {
  users = new Map<string, { profile: UserProfileWrite | null; timezone: string | null }>();
  memberships = new Map<string, string[]>();
  /** `ws/uid` -> shared profile (null: member doc without profile). Missing key: no member doc. */
  members = new Map<string, SharedProfileFields | null>();
  batches: string[][] = [];

  async getUserProfileSource(uid: string) {
    return this.users.get(uid) ?? { profile: null, timezone: null };
  }
  async setUserProfile(uid: string, p: UserProfileWrite) {
    const cur = this.users.get(uid) ?? { profile: null, timezone: null };
    this.users.set(uid, { ...cur, profile: p });
  }
  async listWorkspaceIds(uid: string, limit?: number) {
    const ids = this.memberships.get(uid) ?? [];
    return limit ? ids.slice(0, limit) : ids;
  }
  async getMemberProfile(ws: string, uid: string) {
    const key = `${ws}/${uid}`;
    return this.members.has(key)
      ? { exists: true, profile: this.members.get(key) ?? null }
      : { exists: false, profile: null };
  }
  async setMemberProfiles(ids: string[], uid: string, p: SharedProfileFields) {
    this.batches.push(ids);
    let n = 0;
    for (const id of ids) {
      if (!this.members.has(`${id}/${uid}`)) continue;
      this.members.set(`${id}/${uid}`, p);
      n += 1;
    }
    return n;
  }
}

const setup = () => {
  const store = new FakeStore();
  store.users.set('u1', { profile: null, timezone: 'Europe/Paris' });
  store.memberships.set('u1', ['w1', 'w2', 'w3']);
  store.members.set('w1/u1', null);
  store.members.set('w2/u1', null);
  // w3: member doc missing
  return store;
};

describe('sharedFieldsOf', () => {
  it('includes the time zone only when local time is shared', () => {
    expect(sharedFieldsOf(profile(), 'Europe/Paris').timeZone).toBe('Europe/Paris');
    expect(sharedFieldsOf(profile({ showLocalTime: false }), 'Europe/Paris').timeZone).toBeNull();
    expect(sharedFieldsOf(profile(), 'Europe/Paris')).not.toHaveProperty('showLocalTime');
  });
});

describe('saveMyProfile', () => {
  it('saves the user doc and fans out to every workspace with a member doc', async () => {
    const store = setup();
    const result = await saveMyProfile(store, 'u1', profile());
    expect(result).toEqual({ workspaces: 2 });
    expect(store.users.get('u1')?.profile).toEqual(profile());
    expect(store.members.get('w1/u1')).toEqual({
      title: 'Mom',
      about: 'Hello',
      location: 'Lyon',
      birthday: { month: 3, day: 12 },
      timeZone: 'Europe/Paris',
    });
    expect(store.members.has('w3/u1')).toBe(false);
  });

  it('hides the time zone when local time is off, and is idempotent', async () => {
    const store = setup();
    await saveMyProfile(store, 'u1', profile({ showLocalTime: false }));
    await saveMyProfile(store, 'u1', profile({ showLocalTime: false }));
    expect(store.members.get('w1/u1')?.timeZone).toBeNull();
  });

  it('clearing every field writes nulls to the member docs', async () => {
    const store = setup();
    await saveMyProfile(
      store,
      'u1',
      profile({ title: null, about: null, location: null, birthday: null, showLocalTime: false }),
    );
    expect(store.members.get('w2/u1')).toEqual({
      title: null,
      about: null,
      location: null,
      birthday: null,
      timeZone: null,
    });
  });

  it('writes in batches', async () => {
    const store = new FakeStore();
    store.users.set('u1', { profile: null, timezone: 'UTC' });
    const ids = Array.from({ length: PROFILE_BATCH_SIZE + 5 }, (_, i) => `w${i}`);
    store.memberships.set('u1', ids);
    for (const id of ids) store.members.set(`${id}/u1`, null);
    const result = await saveMyProfile(store, 'u1', profile());
    expect(result.workspaces).toBe(ids.length);
    expect(store.batches.map((b) => b.length)).toEqual([PROFILE_BATCH_SIZE, 5]);
  });
});

describe('syncProfileToWorkspaces and syncProfileOnSignIn', () => {
  it('does nothing when the person never saved a profile', async () => {
    const store = setup();
    expect(await syncProfileOnSignIn(store, 'u1')).toBe(0);
    expect(store.batches).toEqual([]);
  });

  it('copies the profile to member docs that lack it, skips current and missing ones', async () => {
    const store = setup();
    await store.setUserProfile('u1', profile());
    store.members.set('w2/u1', sharedFieldsOf(profile(), 'Europe/Paris'));
    expect(await syncProfileOnSignIn(store, 'u1')).toBe(1);
    expect(store.batches).toEqual([['w1']]);
    expect(store.members.get('w1/u1')?.title).toBe('Mom');
    expect(await syncProfileOnSignIn(store, 'u1')).toBe(0);
  });

  it('heals a changed time zone and a single workspace', async () => {
    const store = setup();
    await store.setUserProfile('u1', profile());
    store.members.set('w1/u1', sharedFieldsOf(profile(), 'Europe/Paris'));
    store.users.set('u1', { profile: profile(), timezone: 'America/New_York' });
    expect(await syncProfileToWorkspaces(store, 'u1', ['w1'])).toBe(1);
    expect(store.members.get('w1/u1')?.timeZone).toBe('America/New_York');
  });
});
