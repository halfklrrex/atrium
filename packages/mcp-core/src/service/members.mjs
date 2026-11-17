// Service methods: members. Receives the shared helpers of `createService` (see ../service.mjs).
import { McpUserError } from '../errors.mjs';

export function membersService(h) {
  const {
    uid,
    resolveWorkspace,
    loadBoard,
    memberProfiles,
    teamsOf,
    memberName,
    sharedProfile,
    boardMembers,
  } = h;
  return {
    async listMembers({ boardId, workspaceId } = {}) {
      if (boardId !== undefined) {
        const { board } = await loadBoard(boardId, 'view');
        return { workspaceId: board.workspaceId, members: await boardMembers(board) };
      }
      const ws = await resolveWorkspace(workspaceId);
      const profiles = await memberProfiles(ws.id);
      const members = [];
      for (const memberUid of ws.memberUids) {
        const profile = profiles.get(memberUid) ?? {};
        members.push({
          uid: memberUid,
          name: memberName(profile, memberUid),
          email: profile.email ?? null,
          workspaceRole: ws.roles[memberUid] ?? null,
          me: memberUid === uid,
          ...sharedProfile(profile),
        });
      }
      return { workspaceId: ws.id, members };
    },
    async findMember({ email, workspaceId }) {
      const wanted = String(email).trim().toLowerCase();
      if (!wanted.includes('@')) throw new McpUserError('Give a full email address.');
      const ws = await resolveWorkspace(workspaceId);
      // Only this workspace's members are ever looked at, so a person elsewhere in Atrium is
      // indistinguishable from an address that has no account.
      const profiles = await memberProfiles(ws.id);
      for (const memberUid of ws.memberUids) {
        const profile = profiles.get(memberUid) ?? {};
        if (typeof profile.email === 'string' && profile.email.trim().toLowerCase() === wanted) {
          return {
            workspaceId: ws.id,
            found: true,
            member: {
              uid: memberUid,
              name: memberName(profile, memberUid),
              email: profile.email,
              workspaceRole: ws.roles[memberUid] ?? null,
              me: memberUid === uid,
              ...sharedProfile(profile),
            },
          };
        }
      }
      return { workspaceId: ws.id, found: false };
    },

    async listTeams({ workspaceId } = {}) {
      const ws = await resolveWorkspace(workspaceId);
      const [teams, profiles] = await Promise.all([teamsOf(ws.id), memberProfiles(ws.id)]);
      return {
        workspaceId: ws.id,
        teams: [...teams.values()]
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
          .map((team) => ({
            id: team.id,
            name: team.name,
            color: team.color,
            // A team lists only current workspace members; a stale uid is left out.
            members: team.memberUids
              .filter((memberUid) => ws.memberUids.includes(memberUid))
              .map((memberUid) => ({
                uid: memberUid,
                name: memberName(profiles.get(memberUid), memberUid),
              })),
          })),
      };
    },
  };
}
