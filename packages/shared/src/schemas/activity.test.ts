import { describe, expect, it } from 'vitest';
import { ACTIVITY_KINDS, ACTIVITY_LIMITS, activityEventSchema, boardSchema } from '../index';

const ts = (ms: number) => ({
  seconds: Math.floor(ms / 1000),
  nanoseconds: 0,
  toDate: () => new Date(ms),
  toMillis: () => ms,
});

const event = (overrides: Record<string, unknown> = {}) => ({
  kind: 'value_changed',
  createdAt: ts(1),
  expiresAt: ts(2),
  actorId: 'u1',
  actorName: 'Avery Quinn',
  actorPhotoUrl: null,
  itemId: 'i1',
  itemName: 'Write spec',
  parentItemId: null,
  columnId: 'status',
  columnTitle: 'Stage',
  columnType: 'text',
  groupId: null,
  groupTitle: null,
  data: { fromText: 'a', toText: 'b', fromValue: 'a', toValue: 'b' },
  ...overrides,
});

describe('automation activity data', () => {
  it('accepts depth 0 to 3 and an automation id, refuses a deeper chain', () => {
    const data = (d: Record<string, unknown>) => activityEventSchema.safeParse(event({ data: d }));
    expect(data({ depth: 0, automationId: 'a1' }).success).toBe(true);
    expect(data({ depth: 3 }).success).toBe(true);
    expect(data({ depth: 4 }).success).toBe(false);
    expect(data({ depth: 1.5 }).success).toBe(false);
    const ran = event({
      kind: 'automation_ran',
      actorId: 'automation:a1',
      data: { automationId: 'a1' },
    });
    expect(activityEventSchema.safeParse(ran).success).toBe(true);
  });
});

describe('activityEventSchema', () => {
  it.each(ACTIVITY_KINDS)('accepts a %s entry', (kind) => {
    expect(activityEventSchema.safeParse(event({ kind })).success).toBe(true);
  });

  it('refuses an unknown kind', () => {
    expect(activityEventSchema.safeParse(event({ kind: 'item_exploded' })).success).toBe(false);
  });

  it('accepts the kind-specific data fields', () => {
    const data = {
      fromRole: 'editor',
      toRole: null,
      targetUid: 'u2',
      targetName: 'Sam Rivera',
      fromKind: 'main',
      toKind: 'private',
      snippet: 'hello',
      more: 3,
      fromGroupId: 'g1',
      fromGroupTitle: 'To do',
      columnColor: '#579bfc',
    };
    expect(activityEventSchema.safeParse(event({ data })).success).toBe(true);
  });

  it('enforces the text and snippet limits', () => {
    const long = 'x'.repeat(ACTIVITY_LIMITS.text + 1);
    expect(activityEventSchema.safeParse(event({ data: { toText: long } })).success).toBe(false);
    expect(activityEventSchema.safeParse(event({ actorName: long })).success).toBe(false);
    expect(
      activityEventSchema.safeParse(
        event({ data: { snippet: 'x'.repeat(ACTIVITY_LIMITS.snippet + 1) } }),
      ).success,
    ).toBe(false);
  });

  it('requires both timestamps', () => {
    const { expiresAt: _expiresAt, ...rest } = event();
    void _expiresAt;
    expect(activityEventSchema.safeParse(rest).success).toBe(false);
  });

  it('keeps the documented limits', () => {
    expect(ACTIVITY_LIMITS).toMatchObject({ retentionDays: 90, perEvent: 20, rawBytes: 2048 });
  });
});

describe('boardSchema.updatedBy', () => {
  it('is optional so older boards still parse', () => {
    const shape = boardSchema.shape;
    expect(shape.updatedBy.safeParse(undefined).success).toBe(true);
    expect(shape.updatedBy.safeParse('u1').success).toBe(true);
    expect(shape.updatedBy.safeParse('').success).toBe(false);
  });
});
