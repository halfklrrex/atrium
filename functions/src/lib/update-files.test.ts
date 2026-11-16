import type { Board, FileAttachment, Workspace, WorkspaceRole } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import {
  isListableItem,
  listBoardUpdateFiles,
  type PostFilesRow,
  type UpdateFilesStore,
} from './update-files';

const OWNER = 'usr_owner';
const VIEWER = 'usr_viewer';
const STRANGER = 'usr_stranger';

const file = (id: string): FileAttachment => ({
  id,
  name: `${id}.png`,
  storagePath: `boards/b_1/items/i_1/updates/u_1/${id}`,
  size: 10,
  mimeType: 'image/png',
  uploadedAt: '2026-11-01T10:00:00.000Z',
  uploadedBy: OWNER,
});

const row = (over: Partial<PostFilesRow> = {}): PostFilesRow => ({
  itemId: 'i_1',
  updateId: 'u_1',
  replyId: null,
  authorId: OWNER,
  createdAt: 1000,
  attachments: [file('f1')],
  ...over,
});

function store(rows: PostFilesRow[], capped = false, boardExists = true): UpdateFilesStore {
  const roles: Record<string, WorkspaceRole> = { [OWNER]: 'owner', [VIEWER]: 'viewer' };
  return {
    async getBoard() {
      return boardExists
        ? ({ workspaceId: 'ws_1', kind: 'main', access: {}, accessUids: [] } as unknown as Board)
        : null;
    },
    async getWorkspace() {
      return { roles, memberIds: Object.keys(roles) } as unknown as Workspace;
    },
    async listPosts() {
      return { rows, truncated: capped };
    },
  };
}

describe('listBoardUpdateFiles', () => {
  it('returns file details only, newest post first, for a board member', async () => {
    const rows = [
      row({ createdAt: 1000, attachments: [file('old')] }),
      row({ createdAt: 3000, replyId: 'r_1', attachments: [file('new')] }),
      row({ createdAt: 2000, attachments: undefined }),
    ];
    const res = await listBoardUpdateFiles(store(rows), { boardId: 'b_1' }, OWNER);
    expect(res.files.map((e) => e.file.id)).toEqual(['new', 'old']);
    expect(res.files[0]).toMatchObject({ replyId: 'r_1', authorId: OWNER, createdAt: 3000 });
    expect(res.truncated).toBe(false);
    expect(JSON.stringify(res)).not.toContain('http');
  });

  it('lets a viewer read', async () => {
    const res = await listBoardUpdateFiles(store([row()]), { boardId: 'b_1' }, VIEWER);
    expect(res.files).toHaveLength(1);
  });

  it('refuses a non-member and a missing board with not-found', async () => {
    await expect(
      listBoardUpdateFiles(store([row()]), { boardId: 'b_1' }, STRANGER),
    ).rejects.toMatchObject({ code: 'not-found' });
    await expect(
      listBoardUpdateFiles(store([row()], false, false), { boardId: 'b_1' }, OWNER),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('skips a post with corrupt attachments instead of failing', async () => {
    const res = await listBoardUpdateFiles(
      store([row({ attachments: [{ bogus: true }] }), row({ attachments: [file('ok')] })]),
      { boardId: 'b_1' },
      OWNER,
    );
    expect(res.files.map((e) => e.file.id)).toEqual(['ok']);
  });

  it('flags truncation when the document cap was hit', async () => {
    const res = await listBoardUpdateFiles(store([row()], true), { boardId: 'b_1' }, OWNER);
    expect(res.truncated).toBe(true);
  });

  it('caps the entries it returns and flags truncation', async () => {
    const rows = [1, 2, 3].map((n) => row({ createdAt: n, attachments: [file(`f${n}`)] }));
    const res = await listBoardUpdateFiles(store(rows), { boardId: 'b_1' }, OWNER, 5000, 2);
    expect(res.files.map((e) => e.file.id)).toEqual(['f3', 'f2']);
    expect(res.truncated).toBe(true);
  });
});

describe('listing edge cases', () => {
  it('skips a post without an author instead of failing the listing', async () => {
    const res = await listBoardUpdateFiles(
      store([row({ authorId: '' }), row({ attachments: [file('ok')] })]),
      { boardId: 'b_1' },
      OWNER,
    );
    expect(res.files.map((e) => e.file.id)).toEqual(['ok']);
  });

  it('lists only active top-level items', () => {
    expect(isListableItem({ state: 'active', parentItemId: null })).toBe(true);
    expect(isListableItem({ state: 'active' })).toBe(true);
    expect(isListableItem({ state: 'deleted', parentItemId: null })).toBe(false);
    expect(isListableItem({ state: 'archived' })).toBe(false);
    expect(isListableItem({ state: 'active', parentItemId: 'i_9' })).toBe(false);
  });
});
