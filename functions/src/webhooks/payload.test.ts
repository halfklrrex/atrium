import { describe, expect, it } from 'vitest';
import { buildEventPayload, buildPingPayload, type ActivityInput } from './payload';

const activity = (over: Partial<ActivityInput> = {}): ActivityInput => ({
  kind: 'value_changed',
  actorId: 'u1',
  actorName: 'Avery Quinn',
  itemId: 'i1',
  itemName: 'Ship it',
  columnId: 'status',
  data: { fromText: 'Working', toText: 'Done', fromValue: { label: 1 }, toValue: { label: 2 } },
  createdAtMs: Date.UTC(2026, 10, 18, 12, 0, 0),
  ...over,
});

describe('buildEventPayload', () => {
  it('has the spec 5.1 shape, with raw values preferred over display text', () => {
    const { body, payload } = buildEventPayload({
      eventId: 'act1',
      boardId: 'b1',
      activity: activity(),
      nowMs: 0,
    });
    expect(payload).toEqual({
      id: 'act1',
      type: 'value_changed',
      createdAt: '2026-11-18T12:00:00.000Z',
      boardId: 'b1',
      itemId: 'i1',
      itemName: 'Ship it',
      columnId: 'status',
      actor: { id: 'u1', name: 'Avery Quinn' },
      data: { from: { label: 1 }, to: { label: 2 } },
    });
    expect(JSON.parse(body)).toEqual(payload);
  });

  it('falls back to the display text and uses now when the entry has no time', () => {
    const { payload } = buildEventPayload({
      eventId: 'a',
      boardId: 'b',
      activity: activity({ data: { fromText: 'A', toText: 'B' }, createdAtMs: null }),
      nowMs: Date.UTC(2026, 0, 1),
    });
    expect(payload.data).toEqual({ from: 'A', to: 'B' });
    expect(payload.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('clips long item names and text values', () => {
    const long = 'x'.repeat(500);
    const { payload } = buildEventPayload({
      eventId: 'a',
      boardId: 'b',
      activity: activity({ itemName: long, data: { toValue: { text: long, list: [long] } } }),
      nowMs: 0,
    });
    expect(payload.itemName).toHaveLength(200);
    const to = payload.data.to as { text: string; list: string[] };
    expect(to.text).toHaveLength(200);
    expect(to.list[0]).toHaveLength(200);
  });

  it('never carries an email address: a name that is one is replaced', () => {
    const { body } = buildEventPayload({
      eventId: 'a',
      boardId: 'b',
      activity: activity({ actorName: 'avery@example.com' }),
      nowMs: 0,
    });
    expect(body).not.toContain('@');
    expect(JSON.parse(body).actor.name).toBe('A member');
  });

  it('keeps the small pass-through fields of other kinds', () => {
    const { payload } = buildEventPayload({
      eventId: 'a',
      boardId: 'b',
      activity: activity({
        kind: 'update_posted',
        data: { snippet: 'Hello there', unknownKey: 'dropped' },
      }),
      nowMs: 0,
    });
    expect(payload.data).toEqual({ snippet: 'Hello there' });
  });

  it('keeps the whole payload at or under 64 KB', () => {
    // 50 keys of 200 characters nested several levels deep cannot reach 64 KB after clipping...
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 50; i += 1) {
      wide[`k${i}`] = Array.from({ length: 50 }, () => 'y'.repeat(200));
    }
    const { body, payload } = buildEventPayload({
      eventId: 'a',
      boardId: 'b',
      activity: activity({ data: { toValue: wide, fromValue: wide } }),
      nowMs: 0,
    });
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(64 * 1024);
    expect(payload.data).toEqual({ truncated: true });
    expect(payload.id).toBe('a');
  });

  it('stops at a depth limit so a deeply nested value cannot recurse forever', () => {
    let deep: unknown = 'end';
    for (let i = 0; i < 50; i += 1) deep = { n: deep };
    expect(() =>
      buildEventPayload({
        eventId: 'a',
        boardId: 'b',
        activity: activity({ data: { toValue: deep } }),
        nowMs: 0,
      }),
    ).not.toThrow();
  });
});

describe('buildPingPayload', () => {
  it('is a ping with no item', () => {
    const { payload } = buildPingPayload({
      eventId: 'ping_1',
      boardId: 'b',
      webhookId: 'w',
      actorId: 'u',
      actorName: 'Avery Quinn',
      nowMs: Date.UTC(2026, 0, 1),
    });
    expect(payload).toMatchObject({
      id: 'ping_1',
      type: 'ping',
      itemId: null,
      data: { webhookId: 'w' },
    });
  });
});
