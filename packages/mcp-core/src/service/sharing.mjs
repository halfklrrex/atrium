// Service methods: sharing (batch 3 PR 2). `setAccess` changes who can see or edit a board, doc or
// dashboard. The change itself runs in `serverOps.setAccess`, which calls the `setBoardAccess`,
// `setDocAccess` and `setDashboardAccess` callables' library code (same owner, workspace-member,
// role-cap and last-owner checks as the Share dialog); this module resolves the person, reports who
// gains and loses access, and guards removals with `dryRun` and `allowDataLoss`. It never invites
// anyone, changes workspace roles or removes members.
import { boardRoleFromWorkspaceRole } from '@atrium/shared';
import { McpUserError, assertId } from '../errors.mjs';

export const SHARING_NEEDS_HOSTED_MESSAGE =
  'Changing sharing needs the hosted Atrium connector; the local server cannot do it.';

const COLLECTIONS = { board: 'boards', doc: 'docs', dashboard: 'dashboards' };
export const SHARING_TARGETS = Object.keys(COLLECTIONS);
export const SHARING_KINDS = ['main', 'private', 'shareable'];
export const SHARING_ROLES = ['owner', 'editor', 'viewer'];

/** Who can open the object and as what: the explicit `access` roles, else a main object's workspace role. */
export function effectiveAccess(entity, roles) {
  const out = new Map();
  for (const [memberUid, workspaceRole] of Object.entries(roles ?? {})) {
    const direct = entity.access?.[memberUid];
    if (direct) out.set(memberUid, direct);
    else if (entity.kind === 'main') out.set(memberUid, boardRoleFromWorkspaceRole(workspaceRole));
  }
  return out;
}

/** Who gains, loses or changes role between two access states. */
export function diffAccess(before, after) {
  const gained = [];
  const lost = [];
  const changed = [];
  for (const [who, role] of after) {
    if (!before.has(who)) gained.push({ uid: who, role });
    else if (before.get(who) !== role) changed.push({ uid: who, from: before.get(who), to: role });
  }
  for (const [who, role] of before) if (!after.has(who)) lost.push({ uid: who, role });
  return { gained, lost, changed };
}

export function sharingService(h, serverOps) {
  const { client, uid, roleOn, workspace, memberProfiles, memberName } = h;

  const requireServerOps = () => {
    if (!serverOps) throw new McpUserError(SHARING_NEEDS_HOSTED_MESSAGE);
    return serverOps;
  };

  async function resolvePerson(who, ws) {
    const wanted = String(who).trim();
    if (wanted === '') throw new McpUserError('person.who is empty.');
    if (wanted.toLowerCase() === 'me') return uid;
    if (ws.memberUids.includes(wanted)) return wanted;
    if (wanted.includes('@')) {
      const profiles = await memberProfiles(ws.id);
      const lower = wanted.toLowerCase();
      for (const memberUid of ws.memberUids) {
        const email = profiles.get(memberUid)?.email;
        if (typeof email === 'string' && email.trim().toLowerCase() === lower) return memberUid;
      }
    }
    throw new McpUserError(
      `"${wanted}" is not a member of this workspace. Only workspace members can be given access; ` +
        'invite people in Atrium first (see atrium_list_members).',
    );
  }

  return {
    async setAccess({ target, id, kind, person, dryRun = false, allowDataLoss = false }) {
      const ops = requireServerOps();
      if (!SHARING_TARGETS.includes(target)) {
        throw new McpUserError(`target must be ${SHARING_TARGETS.join(', ')}.`);
      }
      assertId(id, 'id');
      if (kind !== undefined && !SHARING_KINDS.includes(kind)) {
        throw new McpUserError(`kind must be ${SHARING_KINDS.join(', ')}.`);
      }
      if (person !== undefined && person !== null) {
        if (person.role !== null && !SHARING_ROLES.includes(person.role)) {
          throw new McpUserError(`person.role must be ${SHARING_ROLES.join(', ')} or null.`);
        }
      }
      if (kind === undefined && (person === undefined || person === null)) {
        throw new McpUserError('Give a kind, a person, or both.');
      }
      // The same answer for "missing" and "not yours", as every other tool gives.
      const noun = target;
      const notFound = new McpUserError(
        `${noun.charAt(0).toUpperCase()}${noun.slice(1)} "${id}" was not found in your workspaces.`,
        'not_found',
      );
      const entity = await client.getDoc(`${COLLECTIONS[target]}/${id}`);
      if (!entity || !(await roleOn(entity))) throw notFound;
      const ws = await workspace(entity.workspaceId);
      const personUid =
        person === undefined || person === null ? undefined : await resolvePerson(person.who, ws);
      const request = {
        uid,
        target,
        id,
        ...(kind !== undefined ? { kind } : {}),
        ...(personUid !== undefined ? { person: { uid: personUid, role: person.role } } : {}),
      };

      // The preview and the real run come from the same library call; the preview never writes.
      const preview = await ops.setAccess({ ...request, dryRun: true });
      const before = effectiveAccess(preview.before, preview.roles);
      const after = effectiveAccess(preview.after, preview.roles);
      const diff = diffAccess(before, after);
      const selfOwnerLoss = before.get(uid) === 'owner' && after.get(uid) !== 'owner';
      const profiles = await memberProfiles(entity.workspaceId);
      const nameOf = (who) => memberName(profiles.get(who), who);
      const named = (list) => list.map((entry) => ({ ...entry, name: nameOf(entry.uid) }));
      const report = {
        target,
        id,
        kind: { from: preview.before.kind, to: preview.after.kind },
        gained: named(diff.gained),
        lost: named(diff.lost),
        changedRoles: named(diff.changed),
      };
      const unchanged =
        preview.before.kind === preview.after.kind &&
        diff.gained.length === 0 &&
        diff.lost.length === 0 &&
        diff.changed.length === 0 &&
        JSON.stringify(preview.before.access) === JSON.stringify(preview.after.access);
      const access = (state) =>
        Object.entries(state.access)
          .filter(([who]) => who in preview.roles)
          .map(([who, role]) => ({ uid: who, name: nameOf(who), role }))
          .sort((a, b) => a.name.localeCompare(b.name) || a.uid.localeCompare(b.uid));

      if (dryRun) {
        return {
          dryRun: true,
          wouldChange: !unchanged,
          ...report,
          access: access(preview.after),
          note: unchanged
            ? 'Nothing would change.'
            : 'Preview only; nothing was written. Call again without dryRun to apply it.',
        };
      }
      if (unchanged) {
        return { changed: false, ...report, access: access(preview.after) };
      }
      if ((diff.lost.length > 0 || selfOwnerLoss) && !allowDataLoss) {
        const parts = [];
        if (diff.lost.length > 0) {
          parts.push(
            `${diff.lost.length} ${diff.lost.length === 1 ? 'person' : 'people'} would lose access: ` +
              diff.lost.map((p) => `${nameOf(p.uid)} (was ${p.role})`).join(', '),
          );
        }
        if (selfOwnerLoss) {
          parts.push(
            `you would no longer be an owner of this ${noun} and could not change it again`,
          );
        }
        throw new McpUserError(
          `Refused: ${parts.join('; ')}. Run again with dryRun to preview, or allowDataLoss: true to apply it.`,
        );
      }
      const done = await ops.setAccess({ ...request, dryRun: false });
      const finalDiff = diffAccess(
        effectiveAccess(done.before, done.roles),
        effectiveAccess(done.after, done.roles),
      );
      return {
        changed: true,
        target,
        id,
        kind: { from: done.before.kind, to: done.after.kind },
        gained: named(finalDiff.gained),
        lost: named(finalDiff.lost),
        changedRoles: named(finalDiff.changed),
        access: access(done.after),
      };
    },
  };
}
