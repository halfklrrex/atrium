// The Admin SDK implementation of `@atrium/mcp-core`'s `FirestoreClient` (OPS4 PR C), so the hosted
// MCP Function runs the same `service.mjs` the stdio server runs over the REST client
// (`scripts/showcase/firestore-rest.mjs`). It keeps the REST client's semantics exactly:
//
// - values: `Date` and anything with `toMillis()` go in as a `Timestamp`; timestamps come back as
//   `Date`; `undefined` properties are dropped; references, geo points and bytes come back as plain
//   values (path string, `{ latitude, longitude }`, base64), as the REST decoder returns them.
// - `updateTime` is an opaque string (RFC 3339 with nanoseconds) that a later write can pass back as
//   `precondition: { updateTime }`.
// - `commit` is one `WriteBatch`; a failed precondition (`FAILED_PRECONDITION`, `ALREADY_EXISTS`)
//   rejects with an error whose `status` is 409, which `mutateBoard`'s retry looks for, and a
//   `patch`/`update` of a missing document rejects with `status` 404 (the REST status).
//
// The caller passes the Firestore handle: it must be the named database (`db()` in `lib/admin.ts`,
// built with `FIRESTORE_DATABASE_ID`), never the project's default one.
import {
  DocumentReference,
  FieldPath,
  FieldValue,
  GeoPoint,
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type Firestore,
  type Precondition as AdminPrecondition,
  type Query,
  type QueryDocumentSnapshot,
  type WriteBatch,
} from 'firebase-admin/firestore';
import type { DocRow, FirestoreClient, Precondition, QueryWhere, Write } from '@atrium/mcp-core';

/** gRPC status codes the batch can reject with (google-gax `Status`). */
const GRPC_NOT_FOUND = 5;
const GRPC_ALREADY_EXISTS = 6;
const GRPC_FAILED_PRECONDITION = 9;

type Plain = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Plain =>
  value !== null &&
  typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const hasToMillis = (value: object): value is { toMillis(): number } =>
  typeof (value as { toMillis?: unknown }).toMillis === 'function';

/**
 * JS value -> what the Admin SDK stores. `Date` and anything with `toMillis()` (the SDKs' Timestamps,
 * the connector's `ts()` stand-in) become a `Timestamp` with millisecond precision, like the REST
 * encoder. Field transforms (`FieldValue.*`) pass through untouched.
 */
export function encodeValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`Cannot store ${value} in Firestore`);
    }
    return value;
  }
  if (value instanceof Date) return Timestamp.fromMillis(value.getTime());
  if (value instanceof FieldValue) return value;
  if (hasToMillis(value)) return Timestamp.fromMillis(value.toMillis());
  if (Array.isArray(value)) return value.map(encodeValue);
  if (isPlainObject(value)) return encodeFields(value);
  return value;
}

/** Plain object -> stored fields. `undefined` properties are skipped, like the SDKs and REST do. */
export function encodeFields(object: Plain): DocumentData {
  const fields: DocumentData = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined) continue;
    fields[key] = encodeValue(value);
  }
  return fields;
}

/** Stored value -> JS value: timestamps become `Date`, the other special types plain JSON. */
export function decodeValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof DocumentReference) return value.path;
  if (value instanceof GeoPoint) return { latitude: value.latitude, longitude: value.longitude };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value).toString('base64');
  }
  if (Array.isArray(value)) return value.map(decodeValue);
  return decodeFields(value as Plain);
}

export function decodeFields(fields: Plain): Plain {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeValue(v)]));
}

/** `Timestamp` -> RFC 3339 with nine fractional digits, the shape the REST API returns. */
export function encodeUpdateTime(time: Timestamp): string {
  const whole = new Date(time.seconds * 1000).toISOString().slice(0, -5);
  return `${whole}.${String(time.nanoseconds).padStart(9, '0')}Z`;
}

const UPDATE_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/;

/** The inverse of `encodeUpdateTime`; also accepts the REST API's own `updateTime` strings. */
export function decodeUpdateTime(text: string): Timestamp {
  const match = UPDATE_TIME.exec(text);
  if (!match) throw new Error(`Not an updateTime: ${JSON.stringify(text)}`);
  const seconds = Date.parse(`${match[1]}Z`) / 1000;
  const nanoseconds = Number((match[2] ?? '').padEnd(9, '0'));
  return new Timestamp(seconds, nanoseconds);
}

/** A dotted path (`values.abc-1`) as a `FieldPath`, so odd segments need no backticks. */
const fieldPath = (dotted: string): FieldPath => new FieldPath(...dotted.split('.'));

function adminPrecondition(pre: Precondition): AdminPrecondition {
  return 'updateTime' in pre ? { lastUpdateTime: decodeUpdateTime(pre.updateTime) } : pre;
}

function unsupported(write: Write): never {
  throw new Error(
    `Unsupported Firestore write: ${write.op} with precondition ${JSON.stringify(write.precondition)}`,
  );
}

/** Adds one connector write to the batch, with the REST client's meaning. */
function addWrite(batch: WriteBatch, firestore: Firestore, write: Write): void {
  const ref = firestore.doc(write.path);
  const pre = write.precondition;
  switch (write.op) {
    case 'set': {
      const data = encodeFields(write.data);
      if (!pre) batch.set(ref, data);
      else if ('exists' in pre && pre.exists === false) batch.create(ref, data);
      else unsupported(write);
      return;
    }
    case 'patch': {
      // Top-level fields only: a key with a dot is a field name, not a path (as the fake does).
      if (pre && 'exists' in pre && pre.exists === false) unsupported(write);
      const entries = Object.entries(write.data).filter(([, value]) => value !== undefined);
      if (entries.length === 0) throw new Error(`Empty patch of ${write.path}`);
      const args = entries.flatMap(([key, value]) => [new FieldPath(key), encodeValue(value)]);
      if (pre) args.push(adminPrecondition(pre));
      batch.update(ref, ...(args as [FieldPath, unknown, ...unknown[]]));
      return;
    }
    case 'update': {
      if (pre && 'exists' in pre && pre.exists === false) unsupported(write);
      const args: unknown[] = [];
      for (const [path, value] of Object.entries(write.set ?? {})) {
        if (value === undefined) continue;
        args.push(fieldPath(path), encodeValue(value));
      }
      for (const path of write.remove ?? []) args.push(fieldPath(path), FieldValue.delete());
      for (const [path, by] of Object.entries(write.increment ?? {})) {
        args.push(fieldPath(path), FieldValue.increment(by));
      }
      for (const path of write.serverTimestamp ?? []) {
        args.push(fieldPath(path), FieldValue.serverTimestamp());
      }
      if (args.length === 0) throw new Error(`Empty update of ${write.path}`);
      if (pre) args.push(adminPrecondition(pre));
      batch.update(ref, ...(args as [FieldPath, unknown, ...unknown[]]));
      return;
    }
    case 'delete': {
      if (pre) batch.delete(ref, adminPrecondition(pre));
      else batch.delete(ref);
      return;
    }
    default:
      throw new Error(`unknown op ${(write as { op: string }).op}`);
  }
}

/**
 * Gives a rejected batch the HTTP status the REST client would have reported: 409 for a failed
 * precondition or an existing document, 404 for an update of a missing one. Other errors pass as is.
 */
export function withHttpStatus(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const code = (error as { code?: unknown }).code;
  const status =
    code === GRPC_FAILED_PRECONDITION || code === GRPC_ALREADY_EXISTS
      ? 409
      : code === GRPC_NOT_FOUND
        ? 404
        : undefined;
  if (status === undefined) return error;
  return Object.assign(
    new Error(`Firestore commit -> ${status}: ${error.message}`, { cause: error }),
    {
      status,
      code,
    },
  );
}

const row = (snap: QueryDocumentSnapshot): DocRow => ({
  id: snap.id,
  data: decodeFields(snap.data()),
  updateTime: encodeUpdateTime(snap.updateTime),
});

/**
 * The Admin SDK `FirestoreClient`. `firestore` must be the handle on the named database (`db()` from
 * `lib/admin.ts`); the adapter never creates one itself.
 */
export function createAdminClient(firestore: Firestore): FirestoreClient & { describe: string } {
  return {
    describe: `firebase-admin (database ${firestore.databaseId})`,

    async getDoc(path) {
      const snap = await firestore.doc(path).get();
      return snap.exists ? decodeFields(snap.data() ?? {}) : null;
    },

    async getDocMeta(path) {
      const snap = await firestore.doc(path).get();
      if (!snap.exists || !snap.updateTime) return null;
      return {
        data: decodeFields(snap.data() ?? {}),
        updateTime: encodeUpdateTime(snap.updateTime),
      };
    },

    async listAllDocs(collectionPath, { fields } = {}) {
      const collection: CollectionReference = firestore.collection(collectionPath);
      const query: Query = fields ? collection.select(...fields.map(fieldPath)) : collection;
      return (await query.get()).docs.map(row);
    },

    async runQuery(collectionId, where: QueryWhere = {}) {
      let query: Query = firestore.collection(collectionId);
      for (const [field, condition] of Object.entries(where)) {
        const contains =
          condition !== null && typeof condition === 'object' && 'arrayContains' in condition;
        query = contains
          ? query.where(fieldPath(field), 'array-contains', encodeValue(condition.arrayContains))
          : query.where(fieldPath(field), '==', encodeValue(condition));
      }
      return (await query.get()).docs.map(row);
    },

    async commit(writes) {
      if (writes.length === 0) return;
      const batch = firestore.batch();
      for (const write of writes) addWrite(batch, firestore, write);
      try {
        await batch.commit();
      } catch (error) {
        throw withHttpStatus(error);
      }
    },
  };
}
