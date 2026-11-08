import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxQueries, inboxWrites, useInboxList, useInboxUnreadCount } from './inbox';

const fb = vi.hoisted(() => ({
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
}));

vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => {
  const ref = (path: string) => ({ path, withConverter: () => ({ path }) });
  return {
    collection: (_db: unknown, ...segments: string[]) => ref(segments.join('/')),
    doc: (_db: unknown, ...segments: string[]) => ref(segments.join('/')),
    where: (field: string, op: string, value: unknown) => ['where', field, op, value],
    orderBy: (field: string, dir: string) => ['orderBy', field, dir],
    limit: (n: number) => ['limit', n],
    startAfter: (cursor: unknown) => ['startAfter', cursor],
    query: (source: { path: string }, ...constraints: unknown[]) => ({
      path: source.path,
      constraints,
    }),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    setDoc: fb.setDoc,
    updateDoc: fb.updateDoc,
    getDocs: fb.getDocs,
    onSnapshot: fb.onSnapshot,
  };
});

interface Q {
  path: string;
  constraints: unknown[];
}

beforeEach(() => {
  Object.values(fb).forEach((m) => m.mockReset());
});

describe('inbox query shapes (each is covered by an index)', () => {
  it('both filters: kind + status + lastMessageAt desc', () => {
    expect((inboxQueries.list('open', 'appeal') as unknown as Q).constraints).toEqual([
      ['where', 'kind', '==', 'appeal'],
      ['where', 'status', '==', 'open'],
      ['orderBy', 'lastMessageAt', 'desc'],
      ['limit', 20],
    ]);
  });

  it('status only: status + lastMessageAt desc', () => {
    expect((inboxQueries.list('closed', null) as unknown as Q).constraints).toEqual([
      ['where', 'status', '==', 'closed'],
      ['orderBy', 'lastMessageAt', 'desc'],
      ['limit', 20],
    ]);
  });

  it('kind only: kind + lastMessageAt desc', () => {
    expect((inboxQueries.list(null, 'feedback') as unknown as Q).constraints).toEqual([
      ['where', 'kind', '==', 'feedback'],
      ['orderBy', 'lastMessageAt', 'desc'],
      ['limit', 20],
    ]);
  });

  it('no filter: only the single-field order', () => {
    expect((inboxQueries.list(null, null) as unknown as Q).constraints).toEqual([
      ['orderBy', 'lastMessageAt', 'desc'],
      ['limit', 20],
    ]);
  });

  it('a cursor goes after the order and before the limit', () => {
    const cursor = { id: 'last' };
    const q = inboxQueries.list('open', null, cursor as never) as unknown as Q;
    expect(q.constraints).toEqual([
      ['where', 'status', '==', 'open'],
      ['orderBy', 'lastMessageAt', 'desc'],
      ['startAfter', cursor],
      ['limit', 20],
    ]);
  });

  it('unread count: adminUnread == true, limit 100', () => {
    expect((inboxQueries.unread() as unknown as Q).constraints).toEqual([
      ['where', 'adminUnread', '==', true],
      ['limit', 100],
    ]);
  });

  it('messages are ordered by seq under the thread', () => {
    const q = inboxQueries.messages('t1') as unknown as Q;
    expect(q.path).toBe('inbox/t1/messages');
    expect(q.constraints).toEqual([['orderBy', 'seq', 'asc']]);
  });
});

describe('inboxWrites', () => {
  it('clears the unread flag with exactly adminUnread: false', async () => {
    fb.updateDoc.mockResolvedValue(undefined);
    await inboxWrites.markThreadRead('t1');
    expect(fb.updateDoc).toHaveBeenCalledWith(expect.objectContaining({ path: 'inbox/t1' }), {
      adminUnread: false,
    });
  });

  it('saves the note with exactly text, updatedAt (server time) and updatedBy', async () => {
    fb.setDoc.mockResolvedValue(undefined);
    await inboxWrites.saveNote('t1', 'admin-uid', 'call them back');
    expect(fb.setDoc).toHaveBeenCalledWith(expect.objectContaining({ path: 'inboxNotes/t1' }), {
      text: 'call them back',
      updatedAt: 'SERVER_TIMESTAMP',
      updatedBy: 'admin-uid',
    });
  });

  it('lets a failed write reject so the caller can show it', async () => {
    fb.updateDoc.mockRejectedValue(new Error('permission-denied'));
    await expect(inboxWrites.markThreadRead('t1')).rejects.toThrow('permission-denied');
  });
});

function fakeDocs(ids: string[]) {
  return ids.map((id) => ({ id, data: () => ({ id }) }));
}

describe('useInboxUnreadCount', () => {
  it('counts the live unread threads and stays off when disabled', () => {
    fb.onSnapshot.mockImplementation((_q, next) => {
      next({ docs: fakeDocs(['a', 'b', 'c']) });
      return () => undefined;
    });
    const on = renderHook(() => useInboxUnreadCount(true));
    expect(on.result.current.count).toBe(3);
    fb.onSnapshot.mockClear();
    const off = renderHook(() => useInboxUnreadCount(false));
    expect(off.result.current.count).toBe(0);
    expect(fb.onSnapshot).not.toHaveBeenCalled();
  });
});

describe('useInboxList', () => {
  const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `t${from + i}`);

  it('shows a live first page and reports an error quietly', async () => {
    fb.onSnapshot.mockImplementation((_q, _next, error) => {
      error(new Error('boom'));
      return () => undefined;
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result } = renderHook(() => useInboxList('open', null));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.threads).toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('loads older pages with the cursor of the last row and stops on a short page', async () => {
    const first = fakeDocs(ids(20));
    fb.onSnapshot.mockImplementation((_q, next) => {
      next({ docs: first });
      return () => undefined;
    });
    fb.getDocs.mockResolvedValue({ docs: fakeDocs(ids(5, 20)) });
    const { result } = renderHook(() => useInboxList(null, null));
    expect(result.current.threads).toHaveLength(20);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.threads).toHaveLength(25));
    const q = fb.getDocs.mock.calls[0]![0] as Q;
    expect(q.constraints).toContainEqual(['startAfter', first[19]]);
    expect(result.current.hasMore).toBe(false);
  });

  it('starts over when the filters change', () => {
    fb.onSnapshot.mockImplementation((q: Q, next) => {
      const isOpen = JSON.stringify(q.constraints).includes('"open"');
      next({ docs: fakeDocs(isOpen ? ['o1'] : ['c1', 'c2']) });
      return () => undefined;
    });
    const { result, rerender } = renderHook(
      ({ status }: { status: 'open' | 'closed' }) => useInboxList(status, null),
      { initialProps: { status: 'open' } },
    );
    expect(result.current.threads.map((t) => t.id)).toEqual(['o1']);
    rerender({ status: 'closed' });
    expect(result.current.threads.map((t) => t.id)).toEqual(['c1', 'c2']);
  });
});

describe('sender query shapes (ADMIN-4 PR6)', () => {
  it("an approved person's feedback is filtered by senderUid and kind", () => {
    expect((inboxQueries.mine('u1') as unknown as Q).constraints).toEqual([
      ['where', 'senderUid', '==', 'u1'],
      ['where', 'kind', '==', 'feedback'],
      ['orderBy', 'lastMessageAt', 'desc'],
      ['limit', 20],
    ]);
  });

  it("a blocked person's query filters kind == 'appeal' (the rules refuse it otherwise)", () => {
    const q = inboxQueries.latestAppeal('u1') as unknown as Q;
    expect(q.constraints).toContainEqual(['where', 'kind', '==', 'appeal']);
    expect(q.constraints).toContainEqual(['where', 'senderUid', '==', 'u1']);
    expect(q.constraints).toEqual([
      ['where', 'senderUid', '==', 'u1'],
      ['where', 'kind', '==', 'appeal'],
      ['orderBy', 'lastMessageAt', 'desc'],
      ['limit', 1],
    ]);
  });

  it('opening a thread writes only senderUnread: false', async () => {
    await inboxWrites.markSenderRead('t1');
    expect(fb.updateDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = fb.updateDoc.mock.calls[0]!;
    expect((ref as { path: string }).path).toBe('inbox/t1');
    expect(data).toEqual({ senderUnread: false });
  });
});
