import { beforeEach, describe, expect, it, vi } from 'vitest';

const setDoc = vi.fn(() => Promise.resolve());
const updateDoc = vi.fn(() => Promise.resolve());
const deleteDoc = vi.fn(() => Promise.resolve());

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    withConverter() {
      return this;
    },
  }),
  doc: (parent: unknown, ...segments: string[]) =>
    segments.length > 0
      ? {
          path: `${(parent as { path?: string }).path ?? 'db'}/${segments.join('/')}`,
          id: segments.at(-1),
        }
      : { path: `${(parent as { path: string }).path}/auto1`, id: 'auto1' },
  serverTimestamp: () => 'SERVER_TS',
  setDoc: (...args: unknown[]) => setDoc(...(args as [])),
  updateDoc: (...args: unknown[]) => updateDoc(...(args as [])),
  deleteDoc: (...args: unknown[]) => deleteDoc(...(args as [])),
  onSnapshot: vi.fn(),
}));
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('./firestore', () => ({ requireUid: () => 'u1' }));

import { teamWritesImpl } from './teams-firestore';

beforeEach(() => {
  setDoc.mockClear();
  updateDoc.mockClear();
  deleteDoc.mockClear();
});

describe('teamWritesImpl', () => {
  it('creates with the exact key set the rules require', async () => {
    const id = await teamWritesImpl.create('ws1', {
      name: ' Kids ',
      color: '#579bfc',
      memberUids: ['u1'],
    });
    expect(id).toBe('auto1');
    const [, data] = setDoc.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(Object.keys(data).sort()).toEqual(
      ['color', 'createdAt', 'createdBy', 'memberUids', 'name', 'updatedAt', 'updatedBy'].sort(),
    );
    expect(data).toMatchObject({
      name: 'Kids',
      createdBy: 'u1',
      updatedBy: 'u1',
      createdAt: 'SERVER_TS',
      updatedAt: 'SERVER_TS',
    });
  });

  it('updates only the editable keys', async () => {
    await teamWritesImpl.update('ws1', 't1', { name: 'Kids', color: '#037f4c', memberUids: [] });
    const [, data] = updateDoc.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(Object.keys(data).sort()).toEqual(
      ['color', 'memberUids', 'name', 'updatedAt', 'updatedBy'].sort(),
    );
  });

  it('rejects an invalid input before writing', async () => {
    await expect(
      teamWritesImpl.create('ws1', { name: '', color: '#579bfc', memberUids: [] }),
    ).rejects.toThrow();
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('deletes by path', async () => {
    await teamWritesImpl.remove('ws1', 't1');
    expect(deleteDoc).toHaveBeenCalledTimes(1);
  });
});
