import { type UserProfileWrite } from '@atrium/shared';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { ProfileStore, SharedProfileFields } from './profile';

const asText = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function asBirthday(v: unknown): SharedProfileFields['birthday'] {
  if (typeof v !== 'object' || v === null) return null;
  const { month, day } = v as { month?: unknown; day?: unknown };
  return typeof month === 'number' && typeof day === 'number' ? { month, day } : null;
}

/** Firestore adapter for `setMyProfile` and the member-doc self-heal. */
export function adminProfileStore(firestore: Firestore): ProfileStore {
  const userRef = (uid: string) => firestore.collection('users').doc(uid);
  const memberRef = (workspaceId: string, uid: string) =>
    firestore.collection('workspaces').doc(workspaceId).collection('members').doc(uid);

  return {
    async getUserProfileSource(uid) {
      const snap = await userRef(uid).get();
      const timezone = asText(snap.get('timezone'));
      const raw: unknown = snap.get('profile');
      if (typeof raw !== 'object' || raw === null) return { profile: null, timezone };
      const p = raw as Record<string, unknown>;
      return {
        timezone,
        profile: {
          title: asText(p.title),
          about: asText(p.about),
          location: asText(p.location),
          birthday: asBirthday(p.birthday),
          showLocalTime: p.showLocalTime === true,
        },
      };
    },
    async setUserProfile(uid, profile: UserProfileWrite) {
      await userRef(uid).update({
        profile: { ...profile, updatedAt: FieldValue.serverTimestamp() },
      });
    },
    async listWorkspaceIds(uid, limit) {
      let query = firestore.collection('workspaces').where('memberIds', 'array-contains', uid);
      if (limit) query = query.limit(limit);
      const snap = await query.get();
      return snap.docs.map((d) => d.id);
    },
    async getMemberProfile(workspaceId, uid) {
      const snap = await memberRef(workspaceId, uid).get();
      if (!snap.exists) return { exists: false, profile: null };
      const raw: unknown = snap.get('profile');
      if (typeof raw !== 'object' || raw === null) return { exists: true, profile: null };
      const p = raw as Record<string, unknown>;
      return {
        exists: true,
        profile: {
          title: asText(p.title),
          about: asText(p.about),
          location: asText(p.location),
          birthday: asBirthday(p.birthday),
          timeZone: asText(p.timeZone),
        },
      };
    },
    async setMemberProfiles(workspaceIds, uid, profile) {
      if (workspaceIds.length === 0) return 0;
      const refs = workspaceIds.map((id) => memberRef(id, uid));
      const snaps = await firestore.getAll(...refs);
      const batch = firestore.batch();
      let written = 0;
      for (const snap of snaps) {
        if (!snap.exists) continue;
        batch.update(snap.ref, {
          profile: { ...profile, updatedAt: FieldValue.serverTimestamp() },
        });
        written += 1;
      }
      if (written > 0) await batch.commit();
      return written;
    },
  };
}
