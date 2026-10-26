import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isPresenceActive,
  writeBoardPresence,
  deleteBoardPresence,
  type BoardPresence,
} from './presence';
import * as firestoreModule from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';

type FirestoreNamespace = typeof firestoreModule;

vi.mock('../lib/firebase', () => ({
  db: {},
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<FirestoreNamespace>();
  return {
    ...actual,
    doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
    collection: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
    setDoc: vi.fn().mockResolvedValue(undefined),
    deleteDoc: vi.fn().mockResolvedValue(undefined),
    serverTimestamp: vi.fn(() => ({ _methodName: 'serverTimestamp' })),
    onSnapshot: vi.fn(),
  };
});

describe('isPresenceActive', () => {
  const now = 1_700_000_000_000;
  const asTs = (ms: number) => ({ toMillis: () => ms }) as unknown as Timestamp;
  const asSecTs = (sec: number) => ({ seconds: sec }) as unknown as Timestamp;

  it('treats pending/optimistic timestamps as active', () => {
    const presence: BoardPresence = {
      uid: 'u1',
      displayName: 'Alice',
      photoURL: null,
      lastActiveAt: null,
    };
    expect(isPresenceActive(presence, now)).toBe(true);
  });

  it('returns true when lastActiveAt is within the 60s threshold', () => {
    const activeTimeMs = now - 30_000; // 30s ago
    const presence: BoardPresence = {
      uid: 'u1',
      displayName: 'Alice',
      photoURL: null,
      lastActiveAt: asTs(activeTimeMs),
    };
    expect(isPresenceActive(presence, now)).toBe(true);
  });

  it('returns false when lastActiveAt is older than 60s', () => {
    const staleTimeMs = now - 65_000; // 65s ago
    const presence: BoardPresence = {
      uid: 'u1',
      displayName: 'Alice',
      photoURL: null,
      lastActiveAt: asTs(staleTimeMs),
    };
    expect(isPresenceActive(presence, now)).toBe(false);
  });

  it('supports raw seconds object format', () => {
    const activeSeconds = Math.floor((now - 10_000) / 1000);
    const presence: BoardPresence = {
      uid: 'u1',
      displayName: 'Alice',
      photoURL: null,
      lastActiveAt: asSecTs(activeSeconds),
    };
    expect(isPresenceActive(presence, now)).toBe(true);

    const staleSeconds = Math.floor((now - 70_000) / 1000);
    const stalePresence: BoardPresence = {
      uid: 'u1',
      displayName: 'Alice',
      photoURL: null,
      lastActiveAt: asSecTs(staleSeconds),
    };
    expect(isPresenceActive(stalePresence, now)).toBe(false);
  });

  it('honours a custom threshold', () => {
    const presence: BoardPresence = {
      uid: 'u1',
      displayName: 'Alice',
      photoURL: null,
      lastActiveAt: asTs(now - 15_000),
    };
    expect(isPresenceActive(presence, now, 10_000)).toBe(false);
    expect(isPresenceActive(presence, now, 20_000)).toBe(true);
  });
});

describe('writeBoardPresence and deleteBoardPresence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes presence document to boards/{boardId}/presence/{uid}', async () => {
    await writeBoardPresence('b1', {
      uid: 'u1',
      displayName: 'Alice',
      photoURL: 'https://example.com/alice.png',
    });

    expect(firestoreModule.doc).toHaveBeenCalledWith(
      expect.anything(),
      'boards',
      'b1',
      'presence',
      'u1',
    );
    expect(firestoreModule.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'boards/b1/presence/u1' }),
      expect.objectContaining({
        uid: 'u1',
        displayName: 'Alice',
        photoURL: 'https://example.com/alice.png',
      }),
    );
  });

  it('deletes presence document when leaving a board', async () => {
    await deleteBoardPresence('b1', 'u1');

    expect(firestoreModule.doc).toHaveBeenCalledWith(
      expect.anything(),
      'boards',
      'b1',
      'presence',
      'u1',
    );
    expect(firestoreModule.deleteDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'boards/b1/presence/u1' }),
    );
  });
});
