import type { NotificationPrefs, WorkspaceRole } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import {
  PURGE_BATCH_SIZE,
  addedPeople,
  makeSnippet,
  mentionedUidsOf,
  notifyDescriptionMentions,
  notificationId,
  notifyPeopleAssigned,
  notifyReply,
  notifyUpdateMentions,
  purgeExpiredNotifications,
  retentionCutoff,
  type DescriptionWriteChange,
  type ItemWriteChange,
  type NewNotification,
  type NotificationBoard,
  type NotificationPurgeStore,
  type NotificationStore,
} from './notifications';

const AVERY = 'avery'; // the actor
const BLAKE = 'blake';
const CASEY = 'casey';
const STRANGER = 'stranger'; // not in the workspace

class FakeStore implements NotificationStore {
  board: NotificationBoard | null = {
    name: 'Family board',
    kind: 'main',
    workspaceId: 'ws1',
    access: {},
    columns: [
      { id: 'owner', type: 'people' },
      { id: 'backup', type: 'people' },
      { id: 'status', type: 'status' },
    ],
    subitemColumns: [{ id: 'subowner', type: 'people' }],
  };
  roles: Record<string, WorkspaceRole> = { [AVERY]: 'owner', [BLAKE]: 'member', [CASEY]: 'member' };
  prefs = new Map<string, Partial<NotificationPrefs>>();
  members = new Map([[AVERY, { name: 'Avery Quinn', photoURL: 'https://example.com/avery.png' }]]);
  updateAuthor: string | null = BLAKE;
  docs = new Map<string, NewNotification>();
  /** Documents the user already changed (stands in for `readAt`); create must not touch them. */
  creates = 0;
  reads = 0;

  getBoard() {
    this.reads += 1;
    return Promise.resolve(this.board);
  }
  getWorkspaceRoles() {
    this.reads += 1;
    return Promise.resolve(this.roles);
  }
  getPrefs(uid: string) {
    this.reads += 1;
    return Promise.resolve(this.prefs.get(uid));
  }
  getMemberProfile(_ws: string, uid: string) {
    this.reads += 1;
    return Promise.resolve(this.members.get(uid) ?? null);
  }
  getItemName() {
    this.reads += 1;
    return Promise.resolve('Plan the trip');
  }
  getUpdateAuthorId() {
    this.reads += 1;
    return Promise.resolve(this.updateAuthor);
  }
  createNotification(uid: string, id: string, data: NewNotification) {
    const key = `${uid}/${id}`;
    if (this.docs.has(key)) return Promise.resolve(false);
    this.docs.set(key, data);
    this.creates += 1;
    return Promise.resolve(true);
  }

  forUser(uid: string): NewNotification[] {
    return [...this.docs.entries()].filter(([k]) => k.startsWith(`${uid}/`)).map(([, v]) => v);
  }
}

const people = (...ids: string[]) => ({
  personsAndTeams: ids.map((id) => ({ id, kind: 'person' as const })),
});

const itemChange = (overrides: Partial<ItemWriteChange> = {}): ItemWriteChange => ({
  eventId: 'e1',
  boardId: 'b1',
  itemId: 'i1',
  before: { values: { owner: people(BLAKE) } },
  after: {
    name: 'Plan the trip',
    values: { owner: people(BLAKE, CASEY) },
    updatedBy: AVERY,
    createdBy: AVERY,
  },
  ...overrides,
});

describe('addedPeople', () => {
  const board = new FakeStore().board as NotificationBoard;

  it('returns only newly added person ids, once each', () => {
    const added = addedPeople(
      board,
      false,
      { owner: people(BLAKE) },
      { owner: people(BLAKE, CASEY), backup: people(CASEY) },
    );
    expect(added).toEqual([{ uid: CASEY, kind: 'assigned', columnId: 'owner' }]);
  });

  it('ignores teams and non-people columns, and treats a cleared value as empty', () => {
    const teamOnly = { personsAndTeams: [{ id: 'team1', kind: 'team' }] };
    expect(addedPeople(board, false, {}, { owner: teamOnly, status: people(BLAKE) })).toEqual([]);
    expect(addedPeople(board, false, { owner: people(BLAKE) }, { owner: null })).toEqual([]);
  });

  it('uses subitemColumns for a subitem', () => {
    expect(addedPeople(board, true, {}, { owner: people(BLAKE) })).toEqual([]);
    expect(addedPeople(board, true, {}, { subowner: people(BLAKE) })).toEqual([
      { uid: BLAKE, kind: 'assigned', columnId: 'subowner' },
    ]);
  });
});

describe('notifyPeopleAssigned', () => {
  it('notifies a newly added person with the denormalised display fields', async () => {
    const store = new FakeStore();
    await expect(notifyPeopleAssigned(store, itemChange())).resolves.toBe(1);
    expect(store.forUser(BLAKE)).toEqual([]);
    expect(store.docs.get(`${CASEY}/${notificationId('assigned', 'e1', CASEY)}`)).toEqual({
      kind: 'assigned',
      actorId: AVERY,
      actorName: 'Avery Quinn',
      actorPhotoURL: 'https://example.com/avery.png',
      workspaceId: 'ws1',
      boardId: 'b1',
      boardName: 'Family board',
      itemId: 'i1',
      itemName: 'Plan the trip',
      updateId: null,
      replyId: null,
      columnId: 'owner',
      snippet: '',
    });
  });

  it('sends nothing when a person is removed', async () => {
    const store = new FakeStore();
    const change = itemChange({
      before: { values: { owner: people(BLAKE, CASEY) } },
      after: { name: 'Plan the trip', values: { owner: people(BLAKE) }, updatedBy: AVERY },
    });
    await expect(notifyPeopleAssigned(store, change)).resolves.toBe(0);
    expect(store.docs.size).toBe(0);
  });

  it('reads nothing when values did not change', async () => {
    const store = new FakeStore();
    const values = { owner: people(BLAKE) };
    const change = itemChange({
      before: { values },
      after: { name: 'Renamed', values: { owner: people(BLAKE) }, updatedBy: AVERY },
    });
    await expect(notifyPeopleAssigned(store, change)).resolves.toBe(0);
    expect(store.reads).toBe(0);
  });

  it('does not notify someone who assigns themselves', async () => {
    const store = new FakeStore();
    const change = itemChange({
      before: { values: {} },
      after: { name: 'Plan the trip', values: { owner: people(AVERY) }, updatedBy: AVERY },
    });
    await expect(notifyPeopleAssigned(store, change)).resolves.toBe(0);
  });

  it('does not notify someone who cannot read the board', async () => {
    const store = new FakeStore();
    const change = itemChange({
      before: { values: {} },
      after: { name: 'Plan the trip', values: { owner: people(STRANGER) }, updatedBy: AVERY },
    });
    await expect(notifyPeopleAssigned(store, change)).resolves.toBe(0);
    // A private board the person has no access to is refused too.
    store.board = { ...(store.board as NotificationBoard), kind: 'private' };
    await expect(notifyPeopleAssigned(store, itemChange())).resolves.toBe(0);
  });

  it('respects a disabled preference, and only for that kind', async () => {
    const store = new FakeStore();
    store.prefs.set(CASEY, { assigned: false });
    await expect(notifyPeopleAssigned(store, itemChange())).resolves.toBe(0);
    store.prefs.set(CASEY, { reply: false, mention: false });
    await expect(notifyPeopleAssigned(store, itemChange())).resolves.toBe(1);
  });

  it('notifies on create with a pre-filled people value, crediting createdBy', async () => {
    const store = new FakeStore();
    const change = itemChange({
      before: undefined,
      after: {
        name: 'New item',
        values: { owner: people(BLAKE, CASEY) },
        createdBy: AVERY,
        updatedBy: AVERY,
      },
    });
    await expect(notifyPeopleAssigned(store, change)).resolves.toBe(2);
    expect(store.forUser(BLAKE)[0]?.actorId).toBe(AVERY);
    expect(store.forUser(BLAKE)[0]?.itemName).toBe('New item');
  });

  it('skips items in the trash', async () => {
    const store = new FakeStore();
    const change = itemChange();
    await expect(
      notifyPeopleAssigned(store, { ...change, after: { ...change.after, state: 'deleted' } }),
    ).resolves.toBe(0);
  });

  it('a retried event creates each notification once and leaves the existing doc alone', async () => {
    const store = new FakeStore();
    await notifyPeopleAssigned(store, itemChange());
    await expect(notifyPeopleAssigned(store, itemChange())).resolves.toBe(0);
    expect(store.creates).toBe(1);
    // A different event for the same person is a new notification.
    await notifyPeopleAssigned(store, itemChange({ eventId: 'e2' }));
    expect(store.forUser(CASEY)).toHaveLength(2);
  });
});

describe('notifyReply', () => {
  const reply = (overrides: Record<string, unknown> = {}) => ({
    eventId: 'e1',
    boardId: 'b1',
    itemId: 'i1',
    updateId: 'u1',
    replyId: 'r1',
    reply: { authorId: AVERY, content: 'Sounds good', ...overrides },
  });

  it("notifies the update's author of a reply, with the snippet and thread ids", async () => {
    const store = new FakeStore();
    await expect(notifyReply(store, reply())).resolves.toBe(1);
    expect(store.forUser(BLAKE)).toEqual([
      expect.objectContaining({
        kind: 'reply',
        actorId: AVERY,
        updateId: 'u1',
        replyId: 'r1',
        snippet: 'Sounds good',
      }),
    ]);
  });

  it('sends nothing when replying to your own update', async () => {
    const store = new FakeStore();
    store.updateAuthor = AVERY;
    await expect(notifyReply(store, reply())).resolves.toBe(0);
  });

  it('sends one mention, not two, to the author who is also mentioned', async () => {
    const store = new FakeStore();
    await expect(notifyReply(store, reply({ mentions: [BLAKE, CASEY] }))).resolves.toBe(2);
    expect(store.forUser(BLAKE).map((n) => n.kind)).toEqual(['mention']);
    expect(store.forUser(CASEY).map((n) => n.kind)).toEqual(['mention']);
  });

  it('falls back to the reply author fields when the actor has no member document', async () => {
    const store = new FakeStore();
    store.members.clear();
    await notifyReply(
      store,
      reply({ authorName: 'Avery Quinn', authorPhotoUrl: 'https://example.com/a.png' }),
    );
    expect(store.forUser(BLAKE)[0]).toMatchObject({
      actorName: 'Avery Quinn',
      actorPhotoURL: 'https://example.com/a.png',
    });
  });

  it('a disabled reply pref still allows a mention', async () => {
    const store = new FakeStore();
    store.prefs.set(BLAKE, { reply: false });
    await expect(notifyReply(store, reply())).resolves.toBe(0);
    await expect(notifyReply(store, reply({ mentions: [BLAKE] }))).resolves.toBe(1);
  });
});

describe('notifyUpdateMentions', () => {
  const update = (overrides: Record<string, unknown> = {}) => ({
    eventId: 'e1',
    boardId: 'b1',
    itemId: 'i1',
    updateId: 'u1',
    update: { authorId: AVERY, content: 'Hi @Blake', mentions: [BLAKE], ...overrides },
  });

  it('notifies each mentioned member, never the author', async () => {
    const store = new FakeStore();
    await expect(
      notifyUpdateMentions(store, update({ mentions: [BLAKE, CASEY, AVERY] })),
    ).resolves.toBe(2);
    expect(store.forUser(AVERY)).toEqual([]);
  });

  it('notifies nobody for a forged mention of a non-member', async () => {
    const store = new FakeStore();
    await expect(notifyUpdateMentions(store, update({ mentions: [STRANGER] }))).resolves.toBe(0);
  });

  it('does no reads when there are no mentions', async () => {
    const store = new FakeStore();
    await notifyUpdateMentions(store, update({ mentions: [] }));
    await notifyUpdateMentions(store, update({ mentions: undefined }));
    expect(store.reads).toBe(0);
  });

  it('keeps only the first characters of the text as the snippet', () => {
    expect(makeSnippet(`  ${'x'.repeat(300)}  `)).toHaveLength(200);
    expect(makeSnippet('  hi  ')).toBe('hi');
  });
});

describe('purgeExpiredNotifications', () => {
  const DAY = 24 * 60 * 60 * 1000;

  /** In-memory docs with ages in days; the store honours the cutoff and the limit. */
  class FakePurgeStore implements NotificationPurgeStore {
    constructor(public docs: Map<string, number>) {}
    nowMs = 0;
    listExpired(cutoff: Date, limit: number) {
      const old = [...this.docs.entries()]
        .filter(([, createdMs]) => createdMs < cutoff.getTime())
        .map(([path]) => path);
      return Promise.resolve(old.slice(0, limit));
    }
    deletePaths(paths: string[]) {
      for (const path of paths) this.docs.delete(path);
      return Promise.resolve();
    }
  }

  it('deletes only notifications older than the retention window', async () => {
    const now = 1_800_000_000_000;
    const store = new FakePurgeStore(
      new Map([
        ['users/a/notifications/old', now - 181 * DAY],
        ['users/b/notifications/older', now - 400 * DAY],
        ['users/a/notifications/edge', now - 179 * DAY],
        ['users/a/notifications/new', now - DAY],
      ]),
    );
    await expect(purgeExpiredNotifications(store, now)).resolves.toBe(2);
    expect([...store.docs.keys()].sort()).toEqual([
      'users/a/notifications/edge',
      'users/a/notifications/new',
    ]);
    expect(retentionCutoff(now).getTime()).toBe(now - 180 * DAY);
  });

  it('works through more than one batch', async () => {
    const now = 1_800_000_000_000;
    const docs = new Map<string, number>();
    for (let i = 0; i < PURGE_BATCH_SIZE + 5; i += 1) {
      docs.set(`users/a/notifications/n${i}`, now - 200 * DAY);
    }
    const store = new FakePurgeStore(docs);
    await expect(purgeExpiredNotifications(store, now)).resolves.toBe(PURGE_BATCH_SIZE + 5);
    expect(store.docs.size).toBe(0);
  });
});

const chip = (id: unknown, label = 'Someone') => ({ type: 'mention', attrs: { id, label } });
const descOf = (...nodes: unknown[]) => ({
  doc: { type: 'doc', content: [{ type: 'paragraph', content: nodes }] },
  text: 'Ask @Blake Reed about the trip',
});

describe('mentionedUidsOf', () => {
  it('finds nested chips, ignores other nodes and non-string ids, and de-duplicates', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [chip(BLAKE), chip(BLAKE), chip(42), chip(''), chip(null)] },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [chip(CASEY)] }] }],
        },
        { type: 'emoji', attrs: { id: 'x', name: 'smile' } },
      ],
    };
    expect(mentionedUidsOf(doc)).toEqual([BLAKE, CASEY]);
    expect(mentionedUidsOf(null)).toEqual([]);
    expect(mentionedUidsOf('nope')).toEqual([]);
  });
});

describe('notifyDescriptionMentions', () => {
  const change = (
    before: unknown,
    after: unknown,
    extra: Partial<DescriptionWriteChange['after']> = {},
  ): DescriptionWriteChange => ({
    eventId: 'e1',
    boardId: 'b1',
    itemId: 'i1',
    ...(before === undefined ? {} : { before: { description: before } }),
    after: { name: 'Plan the trip', description: after, updatedBy: AVERY, ...extra },
  });

  it('notifies a new chip once, with the snippet and no update', async () => {
    const store = new FakeStore();
    await expect(
      notifyDescriptionMentions(store, change(undefined, descOf(chip(BLAKE)))),
    ).resolves.toBe(1);
    expect(store.forUser(BLAKE)).toEqual([
      expect.objectContaining({
        kind: 'mention',
        actorId: AVERY,
        itemName: 'Plan the trip',
        updateId: null,
        replyId: null,
        columnId: null,
        snippet: 'Ask @Blake Reed about the trip',
      }),
    ]);
  });

  it('notifies nobody for an unchanged chip, a removed chip, a self mention or a non-member', async () => {
    const store = new FakeStore();
    const withChip = descOf(chip(BLAKE));
    const edited = { ...withChip, text: 'edited text' };
    await expect(notifyDescriptionMentions(store, change(withChip, edited))).resolves.toBe(0);
    await expect(notifyDescriptionMentions(store, change(withChip, descOf()))).resolves.toBe(0);
    await expect(
      notifyDescriptionMentions(store, change(undefined, descOf(chip(AVERY)))),
    ).resolves.toBe(0);
    await expect(
      notifyDescriptionMentions(store, change(undefined, descOf(chip(STRANGER)))),
    ).resolves.toBe(0);
    expect(store.creates).toBe(0);
  });

  it('respects a disabled mention preference', async () => {
    const store = new FakeStore();
    store.prefs.set(BLAKE, { mention: false });
    await expect(
      notifyDescriptionMentions(store, change(undefined, descOf(chip(BLAKE)))),
    ).resolves.toBe(0);
  });

  it('notifies only the newly added chip when a second one appears', async () => {
    const store = new FakeStore();
    await expect(
      notifyDescriptionMentions(
        store,
        change(descOf(chip(BLAKE)), descOf(chip(BLAKE), chip(CASEY))),
      ),
    ).resolves.toBe(1);
    expect(store.forUser(BLAKE)).toHaveLength(0);
    expect(store.forUser(CASEY)).toHaveLength(1);
  });

  it('creates the same notification once when the event is retried', async () => {
    const store = new FakeStore();
    const c = change(undefined, descOf(chip(BLAKE)));
    await expect(notifyDescriptionMentions(store, c)).resolves.toBe(1);
    await expect(notifyDescriptionMentions(store, c)).resolves.toBe(0);
    expect(store.creates).toBe(1);
  });

  it('reads nothing when the description did not change, or when no chip is new', async () => {
    const store = new FakeStore();
    const same = descOf(chip(BLAKE));
    await expect(notifyDescriptionMentions(store, change(same, same))).resolves.toBe(0);
    await expect(notifyDescriptionMentions(store, change(same, descOf()))).resolves.toBe(0);
    expect(store.reads).toBe(0);
  });

  it('skips when the item has no updatedBy, and for a deleted item', async () => {
    const store = new FakeStore();
    const after = descOf(chip(BLAKE));
    const noActor = change(undefined, after);
    delete noActor.after.updatedBy;
    await expect(notifyDescriptionMentions(store, noActor)).resolves.toBe(0);
    await expect(
      notifyDescriptionMentions(store, change(undefined, after, { state: 'deleted' })),
    ).resolves.toBe(0);
    expect(store.creates).toBe(0);
  });
});
