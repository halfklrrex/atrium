// Service methods: team management (create, update, delete). Receives the shared helpers of
// `createService` (see ../service.mjs). Mirrors `apps/web/src/data/teams-firestore.ts` and the rules'
// `validTeam` (`match /teams/{teamId}` in firestore.rules): name 1 to 60 and unique in the workspace
// (case-insensitive, as the dialog checks), color #RRGGBB, at most 100 unique members who are current
// workspace members, owners and admins only, audit fields as the rules require.
import { assigneeTeamIdsOf, columnsForItem, TEAM_LIMITS } from '@atrium/shared';
import { McpUserError, assertId } from '../errors.mjs';
import { newDocId, resolveColor, ts } from '../builders.mjs';

/** The team dialog's default swatch (the web's `GROUP_COLORS[17]`, "Blue"). */
const DEFAULT_TEAM_COLOR = '#579bfc';
const ADMIN_ROLES = ['owner', 'admin'];
/** Boards whose items are counted at once by the delete guard. */
const BOARD_CONCURRENCY = 10;

export function teamsService(h) {
  const { client, uid, now, resolveWorkspace, memberProfiles, teamsOf, memberName } = h;

  /** The workspace to manage teams in; only owners and admins may (the rules' `isWsAdmin`). */
  async function adminWorkspace(workspaceId) {
    const ws = await resolveWorkspace(workspaceId);
    if (!ADMIN_ROLES.includes(ws.role)) {
      throw new McpUserError('Only a workspace owner or admin can create, change or delete teams.');
    }
    return ws;
  }

  const cleanName = (name) => {
    const text = String(name ?? '').trim();
    if (text.length < 1 || text.length > TEAM_LIMITS.name) {
      throw new McpUserError(`A team name is 1 to ${TEAM_LIMITS.name} characters.`);
    }
    return text;
  };

  function assertNameFree(teams, name, exceptId) {
    const wanted = name.toLowerCase();
    for (const team of teams.values()) {
      if (team.id !== exceptId && team.name.trim().toLowerCase() === wanted) {
        throw new McpUserError(`A team named "${team.name}" already exists in this workspace.`);
      }
    }
  }

  /** A team by id or case-insensitive name; two teams with one name need the id. */
  function findTeam(teams, ref) {
    const text = String(ref ?? '').trim();
    if (!text) throw new McpUserError('Name the team (id or name); see atrium_list_teams.');
    const byId = teams.get(text);
    if (byId) return byId;
    const lower = text.toLowerCase();
    const matches = [...teams.values()].filter((t) => t.name.trim().toLowerCase() === lower);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new McpUserError(
        `Several teams are named "${text}"; use one of these ids: ${matches.map((t) => t.id).join(', ')}.`,
      );
    }
    const names = [...teams.values()].map((t) => t.name).sort();
    throw new McpUserError(
      `Team "${text}" was not found.` + (names.length ? ` Teams: ${names.join(', ')}.` : ''),
      'not_found',
    );
  }

  /** Members as uids ("me", a uid or an email), each of whom must be a current workspace member. */
  async function resolveMembers(ws, refs) {
    if (!refs?.length) return [];
    const emailToUid = new Map();
    if (refs.some((r) => String(r).includes('@'))) {
      const profiles = await memberProfiles(ws.id);
      for (const [memberUid, profile] of profiles) {
        if (typeof profile.email === 'string') {
          emailToUid.set(profile.email.trim().toLowerCase(), memberUid);
        }
      }
    }
    const out = [];
    for (const raw of refs) {
      const ref = String(raw).trim();
      const resolved =
        ref.toLowerCase() === 'me'
          ? uid
          : ref.includes('@')
            ? emailToUid.get(ref.toLowerCase())
            : ref;
      if (!resolved || !ws.memberUids.includes(resolved)) {
        throw new McpUserError(
          `"${ref}" is not a member of this workspace; only current workspace members can join a team (see atrium_list_members).`,
        );
      }
      if (!out.includes(resolved)) out.push(resolved);
    }
    return out;
  }

  function assertMemberCount(uids) {
    if (uids.length > TEAM_LIMITS.members) {
      throw new McpUserError(`A team holds at most ${TEAM_LIMITS.members} members.`);
    }
  }

  async function describe(ws, team) {
    const profiles = await memberProfiles(ws.id);
    return {
      id: team.id,
      name: team.name,
      color: team.color,
      members: team.memberUids.map((memberUid) => ({
        uid: memberUid,
        name: memberName(profiles.get(memberUid), memberUid),
      })),
    };
  }

  /** Active items that hold the team, per board of the workspace (the delete guard and its dry run). */
  async function teamUsage(workspaceId, teamId) {
    const boards = await client.runQuery('boards', { workspaceId });
    const perBoard = [];
    for (let at = 0; at < boards.length; at += BOARD_CONCURRENCY) {
      const chunk = boards.slice(at, at + BOARD_CONCURRENCY);
      const counted = await Promise.all(
        chunk.map(async (row) => {
          const docs = await client.runQuery(`boards/${row.id}/items`, {
            assigneeTeamIds: { arrayContains: teamId },
          });
          // The index hint is re-checked against the board's current People columns.
          const items = docs.filter(
            (doc) =>
              doc.data.state === 'active' &&
              assigneeTeamIdsOf(columnsForItem(row.data, doc.data), doc.data.values).includes(
                teamId,
              ),
          ).length;
          return { boardId: row.id, name: row.data.name ?? row.id, items };
        }),
      );
      perBoard.push(...counted.filter((b) => b.items > 0));
    }
    return {
      boards: perBoard.sort(
        (a, b) => a.name.localeCompare(b.name) || a.boardId.localeCompare(b.boardId),
      ),
      items: perBoard.reduce((sum, b) => sum + b.items, 0),
    };
  }

  return {
    async createTeam({ workspaceId, name, color, members }) {
      const ws = await adminWorkspace(workspaceId);
      const text = cleanName(name);
      const teams = await teamsOf(ws.id);
      if (teams.size >= TEAM_LIMITS.perWorkspace) {
        throw new McpUserError(`A workspace holds at most ${TEAM_LIMITS.perWorkspace} teams.`);
      }
      assertNameFree(teams, text);
      const memberUids = await resolveMembers(ws, members);
      assertMemberCount(memberUids);
      const id = newDocId();
      const at = ts(now());
      const data = {
        name: text,
        color: resolveColor(color ?? DEFAULT_TEAM_COLOR),
        memberUids,
        createdAt: at,
        createdBy: uid,
        updatedAt: at,
        updatedBy: uid,
      };
      await client.commit([
        {
          op: 'set',
          path: `workspaces/${ws.id}/teams/${id}`,
          data,
          precondition: { exists: false },
        },
      ]);
      return { workspaceId: ws.id, team: await describe(ws, { id, ...data }) };
    },

    async updateTeam({ workspaceId, team: ref, name, color, addMembers, removeMembers }) {
      const ws = await adminWorkspace(workspaceId);
      if (
        name === undefined &&
        color === undefined &&
        !addMembers?.length &&
        !removeMembers?.length
      ) {
        throw new McpUserError('Nothing to change: give name, color, addMembers or removeMembers.');
      }
      const teams = await teamsOf(ws.id);
      const found = findTeam(teams, ref);
      const path = `workspaces/${ws.id}/teams/${found.id}`;
      const meta = await client.getDocMeta(path);
      if (!meta) throw new McpUserError(`Team "${ref}" was not found.`, 'not_found');
      const patch = {};
      if (name !== undefined) {
        patch.name = cleanName(name);
        assertNameFree(teams, patch.name, found.id);
      }
      if (color !== undefined) patch.color = resolveColor(color);
      const adding = await resolveMembers(ws, addMembers);
      const removing = await resolveMembers(ws, removeMembers).catch(() => {
        // Removing a person who already left the workspace is fine: match by uid or email as given.
        return (removeMembers ?? []).map((r) => String(r).trim());
      });
      // The rules need every stored member to be a current workspace member, so a stale uid left
      // from someone who left the workspace is dropped on any update (and reported).
      const current = found.memberUids.filter((m) => ws.memberUids.includes(m));
      const dropped = found.memberUids.filter((m) => !ws.memberUids.includes(m));
      const next = current.filter((m) => !removing.includes(m));
      for (const m of adding) if (!next.includes(m)) next.push(m);
      assertMemberCount(next);
      patch.memberUids = next;
      patch.updatedAt = ts(now());
      patch.updatedBy = uid;
      await client.commit([
        { op: 'patch', path, data: patch, precondition: { updateTime: meta.updateTime } },
      ]);
      return {
        workspaceId: ws.id,
        team: await describe(ws, {
          id: found.id,
          name: patch.name ?? found.name,
          color: patch.color ?? found.color,
          memberUids: next,
        }),
        ...(dropped.length ? { droppedFormerMembers: dropped } : {}),
      };
    },

    async deleteTeam({ workspaceId, team: ref, dryRun = false, allowDataLoss = false }) {
      const ws = await adminWorkspace(workspaceId);
      const teams = await teamsOf(ws.id);
      const found = findTeam(teams, ref);
      const usage = await teamUsage(ws.id, found.id);
      const needsAllowDataLoss = usage.items > 0;
      const report = {
        workspaceId: ws.id,
        team: await describe(ws, found),
        assignedItems: usage.items,
        boards: usage.boards,
        needsAllowDataLoss,
      };
      if (dryRun) return { ...report, dryRun: true, deleted: false };
      if (needsAllowDataLoss && !allowDataLoss) {
        throw new McpUserError(
          `Team "${found.name}" is assigned on ${usage.items} item${usage.items === 1 ? '' : 's'} in ${usage.boards.length} board${usage.boards.length === 1 ? '' : 's'} ` +
            `(${usage.boards.map((b) => `${b.name}: ${b.items}`).join('; ')}); they would show "Deleted team". ` +
            'Call again with allowDataLoss: true to delete anyway, or dryRun: true to preview.',
        );
      }
      await client.commit([
        {
          op: 'delete',
          path: `workspaces/${ws.id}/teams/${assertId(found.id, 'team id')}`,
          precondition: { exists: true },
        },
      ]);
      return { ...report, dryRun: false, deleted: true };
    },
  };
}
