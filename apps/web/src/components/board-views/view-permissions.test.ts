import { describe, expect, it } from 'vitest';
import { newViewOwner, viewPermissions } from './view-permissions';

const main = { id: 'main', ownerId: null };
const shared = { id: 'v1', ownerId: null };
const mine = { id: 'p1', ownerId: 'me' };
const theirs = { id: 'p2', ownerId: 'other' };

describe('viewPermissions', () => {
  it('lets an editor save, rename, delete and re-scope a shared view', () => {
    expect(viewPermissions(shared, 'me', true)).toEqual({
      canSave: true,
      canRename: true,
      canDuplicate: true,
      canDelete: true,
      canChangeScope: true,
    });
  });

  it('lets a viewer only duplicate a shared view', () => {
    expect(viewPermissions(shared, 'me', false)).toEqual({
      canSave: false,
      canRename: false,
      canDuplicate: true,
      canDelete: false,
      canChangeScope: false,
    });
  });

  it('gives the owner of a personal view full control, a viewer included, except sharing it', () => {
    expect(viewPermissions(mine, 'me', false)).toEqual({
      canSave: true,
      canRename: true,
      canDuplicate: true,
      canDelete: true,
      canChangeScope: false,
    });
    expect(viewPermissions(mine, 'me', true).canChangeScope).toBe(true);
  });

  it('gives nobody control over somebody elses personal view', () => {
    expect(viewPermissions(theirs, 'me', true)).toMatchObject({
      canSave: false,
      canRename: false,
      canDelete: false,
      canChangeScope: false,
    });
  });

  it('never renames, deletes or re-scopes main, but editors save it and everybody duplicates it', () => {
    expect(viewPermissions(main, 'me', true)).toEqual({
      canSave: true,
      canRename: false,
      canDuplicate: true,
      canDelete: false,
      canChangeScope: false,
    });
    expect(viewPermissions(main, 'me', false)).toMatchObject({
      canSave: false,
      canDuplicate: true,
    });
  });

  it('makes new views shared for editors and personal for viewers', () => {
    expect(newViewOwner('me', true)).toBeNull();
    expect(newViewOwner('me', false)).toBe('me');
  });
});
