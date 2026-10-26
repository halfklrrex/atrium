import type { TimestampLike } from '@atrium/shared';
import type { BoardDoc, FolderDoc, ItemDoc, WorkspaceDoc } from '../data/model';

export const ts = (ms = 1_700_000_000_000): TimestampLike => ({
  seconds: Math.floor(ms / 1000),
  nanoseconds: 0,
  toDate: () => new Date(ms),
  toMillis: () => ms,
});

export function makeBoard(overrides: Partial<BoardDoc> & { id: string }): BoardDoc {
  return {
    workspaceId: 'w1',
    folderId: null,
    name: overrides.id,
    description: '',
    kind: 'main',
    access: { u1: 'owner' },
    accessUids: ['u1'],
    position: 'a0',
    icon: null,
    columns: [],
    subitemColumns: [],
    derivedColumnIds: [],
    serverManagedColumnIds: [],
    groups: [],
    itemTerminology: 'item',
    state: 'active',
    deletedAt: null,
    createdAt: ts(),
    createdBy: 'u1',
    updatedAt: ts(),
    ...overrides,
  };
}

export function makeFolder(overrides: Partial<FolderDoc> & { id: string }): FolderDoc {
  return {
    name: overrides.id,
    parentFolderId: null,
    color: '#579bfc',
    position: 'a0',
    createdAt: ts(),
    createdBy: 'u1',
    updatedAt: ts(),
    ...overrides,
  };
}

export function makeWorkspace(overrides: Partial<WorkspaceDoc> & { id: string }): WorkspaceDoc {
  return {
    name: overrides.id,
    description: '',
    icon: 'W',
    color: '#5559df',
    ownerId: 'u1',
    memberIds: ['u1'],
    roles: { u1: 'owner' },
    kind: 'open',
    createdAt: ts(),
    createdBy: 'u1',
    updatedAt: ts(),
    ...overrides,
  };
}

export function makeItem(overrides: Partial<ItemDoc> & { id: string }): ItemDoc {
  return {
    name: overrides.id,
    groupId: 'g1',
    position: 'a0',
    parentItemId: null,
    values: {},
    state: 'active',
    deletedAt: null,
    createdAt: ts(),
    createdBy: 'u1',
    updatedAt: ts(),
    updatedBy: 'u1',
    ...overrides,
  };
}
