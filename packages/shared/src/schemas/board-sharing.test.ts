import { describe, expect, it } from 'vitest';
import {
  BOARD_ROLES,
  WORKSPACE_ROLES,
  boardRoleFromWorkspaceRole,
  capBoardRole,
  type BoardRole,
} from '../roles';
import {
  boardSharingResultSchema,
  leaveBoardRequestSchema,
  setBoardAccessRequestSchema,
  setBoardKindRequestSchema,
} from './board-sharing';

describe('board sharing schemas', () => {
  it('accepts a role or null (remove) and refuses unknown roles and extra keys', () => {
    expect(
      setBoardAccessRequestSchema.safeParse({ boardId: 'b1', uid: 'u1', role: 'editor' }).success,
    ).toBe(true);
    expect(
      setBoardAccessRequestSchema.safeParse({ boardId: 'b1', uid: 'u1', role: null }).success,
    ).toBe(true);
    expect(
      setBoardAccessRequestSchema.safeParse({ boardId: 'b1', uid: 'u1', role: 'admin' }).success,
    ).toBe(false);
    expect(setBoardAccessRequestSchema.safeParse({ boardId: 'b1', uid: 'u1' }).success).toBe(false);
    expect(
      setBoardAccessRequestSchema.safeParse({ boardId: 'b1', uid: 'u1', role: 'owner', x: 1 })
        .success,
    ).toBe(false);
  });

  it('validates kind and leave requests and the result', () => {
    expect(setBoardKindRequestSchema.safeParse({ boardId: 'b1', kind: 'private' }).success).toBe(
      true,
    );
    expect(setBoardKindRequestSchema.safeParse({ boardId: 'b1', kind: 'public' }).success).toBe(
      false,
    );
    expect(leaveBoardRequestSchema.safeParse({ boardId: '' }).success).toBe(false);
    expect(
      boardSharingResultSchema.safeParse({ kind: 'main', access: { u1: 'owner' } }).success,
    ).toBe(true);
    expect(
      boardSharingResultSchema.safeParse({ kind: 'main', access: { u1: 'root' } }).success,
    ).toBe(false);
  });
});

describe('capBoardRole', () => {
  const rank: Record<BoardRole, number> = { viewer: 0, editor: 1, owner: 2 };

  it('is min(workspace-implied role, requested) for every combination', () => {
    for (const workspaceRole of WORKSPACE_ROLES) {
      const ceiling = boardRoleFromWorkspaceRole(workspaceRole)!;
      for (const requested of BOARD_ROLES) {
        const expected = rank[requested] <= rank[ceiling] ? requested : ceiling;
        expect(capBoardRole(workspaceRole, requested)).toBe(expected);
      }
    }
  });

  it('pins the documented cases', () => {
    expect(capBoardRole('viewer', 'editor')).toBe('viewer');
    expect(capBoardRole('member', 'owner')).toBe('editor');
    expect(capBoardRole('admin', 'owner')).toBe('owner');
    expect(capBoardRole('owner', 'viewer')).toBe('viewer');
  });

  it('gives nothing to non-members', () => {
    expect(capBoardRole(null, 'viewer')).toBeNull();
    expect(capBoardRole(undefined, 'owner')).toBeNull();
  });
});
