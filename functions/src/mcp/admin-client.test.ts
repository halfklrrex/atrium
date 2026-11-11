import { FieldPath, FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { McpUserError } from '@atrium/mcp-core';
import { describe, expect, it } from 'vitest';
import {
  createAdminClient,
  decodeUpdateTime,
  decodeValue,
  encodeFields,
  encodeUpdateTime,
  encodeValue,
  withHttpStatus,
} from './admin-client';

/**
 * The pure parts of the Admin SDK adapter: value conversion, the `updateTime` token and the write
 * mapping, against a recording stand-in for `WriteBatch`. The real behaviour (preconditions, field
 * transforms, queries) is covered against the emulator in tests/rules/src/mcp-admin-client.e2e.test.ts.
 */

type Call = { method: string; args: unknown[] };

function fakeFirestore(): { firestore: Firestore; calls: Call[]; committed: () => boolean } {
  const calls: Call[] = [];
  let committed = false;
  const batch = new Proxy(
    {},
    {
      get: (_target, method: string) => {
        if (method === 'commit') {
          return async () => {
            committed = true;
          };
        }
        return (...args: unknown[]) => {
          calls.push({ method, args });
          return batch;
        };
      },
    },
  );
  const firestore = {
    databaseId: 'fake-db',
    doc: (path: string) => ({ path }),
    batch: () => batch,
  } as unknown as Firestore;
  return { firestore, calls, committed: () => committed };
}

describe('value conversion', () => {
  it('encodes Date and toMillis() values as Timestamps and drops undefined, recursively', () => {
    const when = new Date('2026-11-01T10:00:00.123Z');
    const encoded = encodeFields({
      when,
      stamp: { toMillis: () => when.getTime() },
      gone: undefined,
      nested: { when, gone: undefined, list: [when, 1, 'x', null] },
      keep: FieldValue.increment(1),
    }) as Record<string, unknown>;
    expect(encoded.when).toBeInstanceOf(Timestamp);
    expect((encoded.when as Timestamp).toMillis()).toBe(when.getTime());
    expect((encoded.stamp as Timestamp).toMillis()).toBe(when.getTime());
    expect('gone' in encoded).toBe(false);
    const nested = encoded.nested as Record<string, unknown>;
    expect(nested.when).toBeInstanceOf(Timestamp);
    expect('gone' in nested).toBe(false);
    expect((nested.list as unknown[])[0]).toBeInstanceOf(Timestamp);
    expect((nested.list as unknown[]).slice(1)).toEqual([1, 'x', null]);
    expect(encoded.keep).toBeInstanceOf(FieldValue);
  });

  it('refuses NaN and Infinity like the REST encoder', () => {
    expect(() => encodeValue(Number.NaN)).toThrow(/Cannot store/);
    expect(() => encodeValue(Number.POSITIVE_INFINITY)).toThrow(/Cannot store/);
  });

  it('decodes Timestamps to Dates and bytes to base64, recursively', () => {
    const when = new Date('2026-11-01T10:00:00.123Z');
    const decoded = decodeValue({
      when: Timestamp.fromDate(when),
      list: [Timestamp.fromDate(when), { deep: Timestamp.fromDate(when) }],
      bytes: Buffer.from('hi'),
      plain: { a: 1, b: 'x', c: null },
    }) as Record<string, unknown>;
    expect(decoded.when).toEqual(when);
    expect((decoded.list as unknown[])[0]).toEqual(when);
    expect(((decoded.list as unknown[])[1] as { deep: Date }).deep).toEqual(when);
    expect(decoded.bytes).toBe(Buffer.from('hi').toString('base64'));
    expect(decoded.plain).toEqual({ a: 1, b: 'x', c: null });
  });
});

describe('updateTime token', () => {
  it('round-trips a Timestamp with nanoseconds through the RFC 3339 string', () => {
    const time = new Timestamp(1_761_991_200, 123_456_789);
    const text = encodeUpdateTime(time);
    expect(text).toBe('2025-11-01T10:00:00.123456789Z');
    expect(decodeUpdateTime(text).isEqual(time)).toBe(true);
  });

  it('accepts the REST API shapes (fewer digits, none at all)', () => {
    expect(decodeUpdateTime('2025-11-01T10:00:00.123Z').nanoseconds).toBe(123_000_000);
    expect(decodeUpdateTime('2025-11-01T10:00:00Z').nanoseconds).toBe(0);
    expect(() => decodeUpdateTime('yesterday')).toThrow(/Not an updateTime/);
  });
});

describe('error mapping', () => {
  const grpc = (code: number) => Object.assign(new Error(`grpc ${code}`), { code });

  it('maps FAILED_PRECONDITION and ALREADY_EXISTS to 409 and NOT_FOUND to 404', () => {
    expect((withHttpStatus(grpc(9)) as { status: number }).status).toBe(409);
    expect((withHttpStatus(grpc(6)) as { status: number }).status).toBe(409);
    expect((withHttpStatus(grpc(5)) as { status: number }).status).toBe(404);
    const original = grpc(9);
    expect((withHttpStatus(original) as Error).cause).toBe(original);
  });

  it('passes other errors through unchanged', () => {
    const other = grpc(13);
    expect(withHttpStatus(other)).toBe(other);
    expect(withHttpStatus('string')).toBe('string');
  });
});

describe('commit mapping', () => {
  it('turns the connector writes into the matching WriteBatch calls, in order', async () => {
    const { firestore, calls, committed } = fakeFirestore();
    const client = createAdminClient(firestore);
    const when = new Date('2026-11-01T10:00:00Z');
    await client.commit([
      { op: 'set', path: 'a/1', data: { n: 1 }, precondition: { exists: false } },
      { op: 'set', path: 'a/2', data: { when } },
      {
        op: 'patch',
        path: 'a/3',
        data: { 'dotted.name': 'top-level', gone: undefined, when },
        precondition: { updateTime: '2025-11-01T10:00:00.000000001Z' },
      },
      {
        op: 'update',
        path: 'a/4',
        set: { 'values.abc-1': 'x', skipped: undefined },
        remove: ['values.old'],
        increment: { count: 2 },
        serverTimestamp: ['touchedAt'],
      },
      { op: 'delete', path: 'a/5' },
      { op: 'delete', path: 'a/6', precondition: { updateTime: '2025-11-01T10:00:00Z' } },
    ]);
    expect(committed()).toBe(true);
    expect(calls.map((c) => c.method)).toEqual([
      'create',
      'set',
      'update',
      'update',
      'delete',
      'delete',
    ]);

    expect(calls[0]!.args).toEqual([{ path: 'a/1' }, { n: 1 }]);
    expect((calls[1]!.args[1] as { when: Timestamp }).when.toMillis()).toBe(when.getTime());

    // patch: literal top-level field names, undefined dropped, lastUpdateTime last.
    const patch = calls[2]!.args;
    expect(patch[0]).toEqual({ path: 'a/3' });
    expect((patch[1] as FieldPath).isEqual(new FieldPath('dotted.name'))).toBe(true);
    expect(patch[2]).toBe('top-level');
    expect((patch[3] as FieldPath).isEqual(new FieldPath('when'))).toBe(true);
    expect(patch[4]).toBeInstanceOf(Timestamp);
    expect(patch).toHaveLength(6);
    const pre = patch[5] as { lastUpdateTime: Timestamp };
    expect(pre.lastUpdateTime.isEqual(new Timestamp(1_761_991_200, 1))).toBe(true);

    // update: dotted paths become FieldPath segments; transforms are FieldValues; no precondition.
    const update = calls[3]!.args;
    expect((update[1] as FieldPath).isEqual(new FieldPath('values', 'abc-1'))).toBe(true);
    expect(update[2]).toBe('x');
    expect((update[3] as FieldPath).isEqual(new FieldPath('values', 'old'))).toBe(true);
    expect((update[4] as FieldValue).isEqual(FieldValue.delete())).toBe(true);
    expect((update[5] as FieldPath).isEqual(new FieldPath('count'))).toBe(true);
    expect((update[6] as FieldValue).isEqual(FieldValue.increment(2))).toBe(true);
    expect((update[7] as FieldPath).isEqual(new FieldPath('touchedAt'))).toBe(true);
    expect((update[8] as FieldValue).isEqual(FieldValue.serverTimestamp())).toBe(true);
    expect(update).toHaveLength(9);

    expect(calls[4]!.args).toEqual([{ path: 'a/5' }]);
    const del = calls[5]!.args[1] as { lastUpdateTime: Timestamp };
    expect(del.lastUpdateTime.isEqual(new Timestamp(1_761_991_200, 0))).toBe(true);
  });

  it('skips an empty commit and refuses writes the REST client cannot express either', async () => {
    const { firestore, calls, committed } = fakeFirestore();
    const client = createAdminClient(firestore);
    await client.commit([]);
    expect(committed()).toBe(false);
    expect(calls).toEqual([]);
    await expect(
      client.commit([{ op: 'set', path: 'a/1', data: {}, precondition: { exists: true } }]),
    ).rejects.toThrow(/Unsupported/);
    await expect(
      client.commit([{ op: 'update', path: 'a/1', set: {}, precondition: { exists: false } }]),
    ).rejects.toThrow(/Unsupported/);
    await expect(client.commit([{ op: 'patch', path: 'a/1', data: {} }])).rejects.toThrow(
      /Empty patch/,
    );
    await expect(client.commit([{ op: 'update', path: 'a/1' }])).rejects.toThrow(/Empty update/);
  });

  it('names the database it talks to and resolves @atrium/mcp-core through the alias', () => {
    const { firestore } = fakeFirestore();
    expect(createAdminClient(firestore).describe).toBe('firebase-admin (database fake-db)');
    expect(new McpUserError('x')).toBeInstanceOf(Error);
  });
});
