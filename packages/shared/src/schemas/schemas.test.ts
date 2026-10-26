import { describe, expect, it } from 'vitest';
import {
  accessUidsOf,
  bootstrapUserRequestSchema,
  bootstrapUserResultSchema,
  boardRoleFromWorkspaceRole,
  boardSchema,
  canEditBoard,
  canManageBoard,
  columnDefSchema,
  columnRegistry,
  createBoardInputSchema,
  createItemUpdateInputSchema,
  createUpdateReplyInputSchema,
  createWorkspaceInputSchema,
  defaultBoardStructure,
  duplicateBoardName,
  favoriteSchema,
  folderInputSchema,
  folderSchema,
  groupDefSchema,
  itemSchema,
  itemUpdateSchema,
  personalWorkspaceName,
  recentSchema,
  resolveBoardRole,
  updateReplySchema,
  userProfileUpdateSchema,
  userSchema,
  workspaceSchema,
  type TimestampLike,
} from '../index';

const ts = (ms = 1_700_000_000_000): TimestampLike => ({
  seconds: Math.floor(ms / 1000),
  nanoseconds: 0,
  toDate: () => new Date(ms),
  toMillis: () => ms,
});

const workspace = {
  name: "Ada's workspace",
  description: '',
  icon: 'A',
  color: '#6161ff',
  ownerId: 'u1',
  memberIds: ['u1'],
  roles: { u1: 'owner' },
  kind: 'open',
  createdAt: ts(),
  createdBy: 'u1',
  updatedAt: ts(),
};

const board = {
  workspaceId: 'w1',
  folderId: null,
  name: 'Roadmap',
  description: '',
  kind: 'main',
  access: { u1: 'owner' },
  accessUids: ['u1'],
  position: 'a0',
  icon: null,
  columns: [
    {
      id: 'status',
      type: 'status',
      title: 'Status',
      position: 'a0',
      settings: columnRegistry.defaultSettings('status') as Record<string, unknown>,
    },
  ],
  subitemColumns: [],
  groups: [{ id: 'g1', title: 'Group', color: '#579bfc', position: 'a0' }],
  itemTerminology: 'item',
  state: 'active',
  deletedAt: null,
  createdAt: ts(),
  createdBy: 'u1',
  updatedAt: ts(),
};

describe('user schemas', () => {
  const user = {
    displayName: 'Ada Lovelace',
    email: 'ada@example.com',
    photoURL: null,
    timezone: 'America/New_York',
    locale: 'en',
    lastWorkspaceId: null,
    theme: 'system',
    createdAt: ts(),
  };

  it('accepts a valid user and rejects an unknown theme', () => {
    expect(userSchema.safeParse(user).success).toBe(true);
    expect(userSchema.safeParse({ ...user, theme: 'neon' }).success).toBe(false);
  });

  it('only allows self-editable profile fields', () => {
    expect(userProfileUpdateSchema.safeParse({ theme: 'dark' }).success).toBe(true);
    expect(userProfileUpdateSchema.safeParse({ email: 'x@y.z' }).success).toBe(false);
  });
});

describe('workspace schemas', () => {
  it('accepts a valid workspace', () => {
    expect(workspaceSchema.safeParse(workspace).success).toBe(true);
  });

  it('rejects bad colours, roles and empty member lists', () => {
    expect(workspaceSchema.safeParse({ ...workspace, color: 'red' }).success).toBe(false);
    expect(workspaceSchema.safeParse({ ...workspace, roles: { u1: 'god' } }).success).toBe(false);
    expect(workspaceSchema.safeParse({ ...workspace, memberIds: [] }).success).toBe(false);
  });

  it('validates the create form and trims the name', () => {
    const ok = createWorkspaceInputSchema.parse({ name: '  Home  ', icon: 'H', color: '#00c875' });
    expect(ok).toMatchObject({ name: 'Home', description: '' });
    expect(
      createWorkspaceInputSchema.safeParse({ name: '   ', icon: 'H', color: '#00c875' }).success,
    ).toBe(false);
  });

  it('validates folders', () => {
    const folder = {
      name: 'Q4',
      parentFolderId: null,
      color: '#ffcb00',
      position: 'a0',
      createdAt: ts(),
      createdBy: 'u1',
      updatedAt: ts(),
    };
    expect(folderSchema.safeParse(folder).success).toBe(true);
    expect(folderSchema.safeParse({ ...folder, name: '' }).success).toBe(false);
  });

  it('names personal workspaces after the first name, falling back to the email', () => {
    expect(personalWorkspaceName('Ada Lovelace')).toBe("Ada's workspace");
    expect(personalWorkspaceName('  ', 'grace@example.com')).toBe("grace's workspace");
    expect(personalWorkspaceName(undefined, undefined)).toBe('My workspace');
  });
});

describe('board and item schemas', () => {
  it('accepts a valid board', () => {
    expect(boardSchema.safeParse(board).success).toBe(true);
  });

  it('rejects invalid kinds and access roles', () => {
    expect(boardSchema.safeParse({ ...board, kind: 'public' }).success).toBe(false);
    expect(boardSchema.safeParse({ ...board, access: { u1: 'admin' } }).success).toBe(false);
  });

  it('validates column and group definitions', () => {
    expect(columnDefSchema.safeParse(board.columns[0]).success).toBe(true);
    expect(columnDefSchema.safeParse({ ...board.columns[0], id: 'has space' }).success).toBe(false);
    expect(groupDefSchema.safeParse({ ...board.groups[0], color: 'blue' }).success).toBe(false);
  });

  it('accepts items and lets column values be checked against the registry', () => {
    const item = {
      name: 'First item',
      groupId: 'g1',
      position: 'a0',
      parentItemId: null,
      values: { status: { index: 1 } },
      state: 'active',
      deletedAt: null,
      createdAt: ts(),
      createdBy: 'u1',
      updatedAt: ts(),
      updatedBy: 'u1',
    };
    const parsed = itemSchema.parse(item);
    expect(columnRegistry.parseValue('status', parsed.values.status).success).toBe(true);
    expect(columnRegistry.parseValue('status', { index: -3 }).success).toBe(false);
    expect(itemSchema.safeParse({ ...item, name: '' }).success).toBe(false);
    const description = { doc: { type: 'doc', content: [] }, text: 'Hi' };
    expect(itemSchema.safeParse({ ...item, description }).success).toBe(true);
    expect(itemSchema.safeParse({ ...item, description: null }).success).toBe(true);
    expect(itemSchema.safeParse({ ...item, description: { text: 'x' } }).success).toBe(false);
  });
});

describe('P1a board additions', () => {
  it('requires accessUids, position and icon on a board', () => {
    const { accessUids: _a, ...noAccessUids } = board;
    expect(boardSchema.safeParse(noAccessUids).success).toBe(false);
    const { position: _p, ...noPosition } = board;
    expect(boardSchema.safeParse(noPosition).success).toBe(false);
    expect(boardSchema.safeParse({ ...board, icon: 'x' }).success).toBe(true);
    expect(boardSchema.safeParse({ ...board, accessUids: [] }).success).toBe(false);
  });

  it('derives accessUids from the access map', () => {
    expect(accessUidsOf({ u1: 'owner', u2: 'viewer' })).toEqual(['u1', 'u2']);
  });

  it('validates the new board and folder forms', () => {
    expect(createBoardInputSchema.parse({ name: '  Plan ' })).toEqual({
      name: 'Plan',
      kind: 'main',
      folderId: null,
    });
    expect(createBoardInputSchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(createBoardInputSchema.safeParse({ name: 'x', kind: 'public' }).success).toBe(false);
    expect(folderInputSchema.parse({ name: 'Q4', color: '#ffcb00' }).parentFolderId).toBeNull();
    expect(folderInputSchema.safeParse({ name: 'Q4', color: 'gold' }).success).toBe(false);
  });

  it('builds the monday default board: Person, Status, Date and two groups', () => {
    let n = 0;
    const s = defaultBoardStructure(() => `g${++n}`);
    expect(s.columns.map((c) => [c.id, c.type, c.title])).toEqual([
      ['person', 'people', 'Person'],
      ['status', 'status', 'Status'],
      ['date', 'date', 'Date'],
    ]);
    for (const c of s.columns) {
      expect(columnRegistry.parseSettings(c.type, c.settings).success).toBe(true);
      expect(columnDefSchema.safeParse(c).success).toBe(true);
    }
    expect(s.groups.map((g) => [g.id, g.title, g.position])).toEqual([
      ['g1', 'Group Title', 'a0'],
      ['g2', 'Group Title', 'a1'],
    ]);
    expect(s.groups.every((g) => groupDefSchema.safeParse(g).success)).toBe(true);
    expect(s.subitemColumns).toEqual([]);
    expect(s.itemTerminology).toBe('item');
    const status = s.columns[1]!.settings as { labels: { label: string; color: string }[] };
    expect(status.labels.map((l) => l.label)).toEqual(['Working on it', 'Done', 'Stuck', '']);
  });

  it('names board copies and keeps them within the limit', () => {
    expect(duplicateBoardName('Roadmap')).toBe('Roadmap (copy)');
    expect(duplicateBoardName('x'.repeat(120))).toHaveLength(120);
  });

  it('validates favourites and recents', () => {
    const favorite = { boardId: 'b1', workspaceId: 'w1', addedAt: ts(), position: 'a0' };
    expect(favoriteSchema.safeParse(favorite).success).toBe(true);
    expect(favoriteSchema.safeParse({ ...favorite, position: '' }).success).toBe(false);
    const recent = { boardId: 'b1', workspaceId: 'w1', visitedAt: ts() };
    expect(recentSchema.safeParse(recent).success).toBe(true);
    expect(recentSchema.safeParse({ ...recent, boardId: '' }).success).toBe(false);
  });
});

describe('role helpers', () => {
  it('derives board roles from workspace roles', () => {
    expect(boardRoleFromWorkspaceRole('owner')).toBe('owner');
    expect(boardRoleFromWorkspaceRole('admin')).toBe('owner');
    expect(boardRoleFromWorkspaceRole('member')).toBe('editor');
    expect(boardRoleFromWorkspaceRole('viewer')).toBe('viewer');
    expect(boardRoleFromWorkspaceRole(undefined)).toBeNull();
  });

  it('resolves explicit access first and only derives for main boards', () => {
    const main = {
      kind: 'main' as const,
      access: { u1: 'viewer' as const, stale: 'owner' as const },
    };
    expect(resolveBoardRole(main, 'u1', 'owner')).toBe('viewer');
    expect(resolveBoardRole(main, 'u2', 'member')).toBe('editor');
    const priv = { kind: 'private' as const, access: { u3: 'editor' as const } };
    expect(resolveBoardRole(priv, 'u2', 'owner')).toBeNull();
    expect(resolveBoardRole(priv, 'u3', 'member')).toBe('editor');

    // Unit table mirroring firestore.rules boardRole():
    // 1. Removed member: stale access entry is dead when workspaceRole is null/undefined
    expect(resolveBoardRole(main, 'stale', null)).toBeNull();
    expect(resolveBoardRole(main, 'stale', undefined)).toBeNull();
    expect(resolveBoardRole(priv, 'u3', null)).toBeNull();
    // 2. Private board: null without explicit access even for workspace owner/admin
    expect(resolveBoardRole({ kind: 'private', access: {} }, 'u_any', 'owner')).toBeNull();
    expect(resolveBoardRole({ kind: 'private', access: {} }, 'u_any', 'admin')).toBeNull();
    // 3. Main board: derives owner/editor/viewer from workspace role
    expect(resolveBoardRole({ kind: 'main', access: {} }, 'u_any', 'owner')).toBe('owner');
    expect(resolveBoardRole({ kind: 'main', access: {} }, 'u_any', 'admin')).toBe('owner');
    expect(resolveBoardRole({ kind: 'main', access: {} }, 'u_any', 'member')).toBe('editor');
    expect(resolveBoardRole({ kind: 'main', access: {} }, 'u_any', 'viewer')).toBe('viewer');
    // 4. Viewer: workspace viewer gets viewer role (cannot edit)
    const viewerRole = resolveBoardRole({ kind: 'main', access: {} }, 'u_view', 'viewer');
    expect(viewerRole).toBe('viewer');
    expect(canEditBoard(viewerRole)).toBe(false);
  });

  it('maps roles to capabilities', () => {
    expect(canEditBoard('editor')).toBe(true);
    expect(canEditBoard('viewer')).toBe(false);
    expect(canManageBoard('owner')).toBe(true);
    expect(canManageBoard('editor')).toBe(false);
  });
});

describe('callable schemas', () => {
  it('accepts optional client hints but no extra keys', () => {
    expect(bootstrapUserRequestSchema.safeParse({}).success).toBe(true);
    expect(bootstrapUserRequestSchema.safeParse({ timezone: 'America/New_York' }).success).toBe(
      true,
    );
    expect(bootstrapUserRequestSchema.safeParse({ uid: 'other' }).success).toBe(false);
    expect(bootstrapUserResultSchema.safeParse({ workspaceId: 'w1' }).success).toBe(true);
    expect(bootstrapUserResultSchema.safeParse({}).success).toBe(false);
  });
});

describe('update and reply schemas', () => {
  const update = {
    itemId: 'item1',
    authorId: 'u1',
    authorName: 'Ada Lovelace',
    authorPhotoUrl: 'https://example.com/ada.png',
    content: '<p>Here is an update</p>',
    likes: ['u1', 'u2'],
    repliesCount: 0,
    createdAt: ts(),
    updatedAt: ts(),
  };

  const reply = {
    updateId: 'up1',
    authorId: 'u2',
    authorName: 'Grace Hopper',
    authorPhotoUrl: null,
    content: 'Great progress!',
    likes: ['u1'],
    createdAt: ts(),
    updatedAt: ts(),
  };

  it('validates item update documents', () => {
    expect(itemUpdateSchema.safeParse(update).success).toBe(true);
    expect(itemUpdateSchema.safeParse({ ...update, content: '' }).success).toBe(false);
    expect(itemUpdateSchema.safeParse({ ...update, repliesCount: -1 }).success).toBe(false);
  });

  it('validates update reply documents', () => {
    expect(updateReplySchema.safeParse(reply).success).toBe(true);
    expect(updateReplySchema.safeParse({ ...reply, content: '' }).success).toBe(false);
    expect(updateReplySchema.safeParse({ ...reply, authorId: '' }).success).toBe(false);
  });

  it('validates create inputs', () => {
    expect(createItemUpdateInputSchema.safeParse({ content: 'Hello world' }).success).toBe(true);
    expect(createItemUpdateInputSchema.safeParse({ content: '   ' }).success).toBe(false);
    expect(createUpdateReplyInputSchema.safeParse({ content: 'Reply content' }).success).toBe(true);
    expect(createUpdateReplyInputSchema.safeParse({ content: '' }).success).toBe(false);
  });
});
