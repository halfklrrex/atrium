// A tiny Firestore REST client: no SDK, no service-account key, no ADC.
//
// - Emulator: `http://<FIRESTORE_EMULATOR_HOST>` with the emulator's `Bearer owner` token (it
//   bypasses security rules, like the Admin SDK does).
// - Production: `https://firestore.googleapis.com` with `gcloud auth print-access-token`.
//
// It talks to Atrium's named Firestore database (`FIRESTORE_DATABASE_ID` in @atrium/shared) unless told otherwise.
//
// It only does what the seed script needs: get, list, list sub-collections, and batched commits.

import { FIRESTORE_DATABASE_ID } from '@atrium/shared';

const SERVER_ERRORS = new Set([429, 500, 502, 503, 504]);

/** JS value -> Firestore REST `Value`. Anything with `toMillis()` (or a Date) becomes a timestamp. */
export function encodeValue(value) {
  if (value === null) return { nullValue: null };
  switch (typeof value) {
    case 'string':
      return { stringValue: value };
    case 'boolean':
      return { booleanValue: value };
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`Cannot store ${value} in Firestore`);
      return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    case 'object': {
      if (value instanceof Date) return { timestampValue: value.toISOString() };
      if (typeof value.toMillis === 'function') {
        return { timestampValue: new Date(value.toMillis()).toISOString() };
      }
      if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
      return { mapValue: { fields: encodeFields(value) } };
    }
    default:
      throw new Error(`Cannot encode a ${typeof value} for Firestore`);
  }
}

/** Plain object -> REST `fields`. `undefined` properties are skipped, like the SDKs do. */
export function encodeFields(object) {
  const fields = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined) continue;
    fields[key] = encodeValue(value);
  }
  return fields;
}

/** Firestore REST `Value` -> JS value (timestamps become `Date`). */
export function decodeValue(value) {
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields ?? {});
  if ('referenceValue' in value) return value.referenceValue;
  if ('geoPointValue' in value) return value.geoPointValue;
  if ('bytesValue' in value) return value.bytesValue;
  throw new Error(`Unknown Firestore value: ${JSON.stringify(value)}`);
}

export function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeValue(v)]));
}

/**
 * @param {object} options
 * @param {string} options.origin       `http://127.0.0.1:8080` or `https://firestore.googleapis.com`.
 * @param {string} options.project      Firebase project id.
 * @param {() => Promise<string>|string} options.getToken  Bearer token provider.
 * @param {string} [options.quotaProject]  Sent as `x-goog-user-project` (user credentials need one).
 * @param {string} [options.database]   Firestore database id; defaults to `FIRESTORE_DATABASE_ID`.
 * @param {typeof fetch} [options.fetch]
 */
export function createFirestoreRest({
  origin,
  project,
  getToken,
  quotaProject,
  database = FIRESTORE_DATABASE_ID,
  fetch: f = fetch,
}) {
  const root = `projects/${project}/databases/${database}/documents`;
  const base = `${origin}/v1/${root}`;

  async function request(method, url, body) {
    const token = await getToken();
    for (let attempt = 0; ; attempt += 1) {
      const response = await f(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...(quotaProject ? { 'x-goog-user-project': quotaProject } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.ok) return response.status === 204 ? {} : response.json();
      if (response.status === 404) return null;
      if (SERVER_ERRORS.has(response.status) && attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
        continue;
      }
      const text = await response.text();
      throw new Error(
        `Firestore ${method} ${url.replace(origin, '')} -> ${response.status}: ${text}`,
      );
    }
  }

  const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

  return {
    describe: `${origin} (project ${project}, database ${database})`,
    project,
    database,

    /** The decoded fields of a document, or `null` when it does not exist. */
    async getDoc(path) {
      const doc = await request('GET', `${base}/${encodePath(path)}`);
      return doc ? decodeFields(doc.fields ?? {}) : null;
    },

    /** Ids of the documents in a collection, including "missing" ones that only have sub-documents. */
    async listDocIds(collectionPath) {
      const ids = [];
      let pageToken = '';
      do {
        const query = new URLSearchParams({
          pageSize: '300',
          showMissing: 'true',
          'mask.fieldPaths': '__name__',
        });
        if (pageToken) query.set('pageToken', pageToken);
        const page = await request('GET', `${base}/${encodePath(collectionPath)}?${query}`);
        for (const doc of page?.documents ?? []) ids.push(doc.name.split('/').at(-1));
        pageToken = page?.nextPageToken ?? '';
      } while (pageToken);
      return ids;
    },

    /** Decoded documents (with ids) of a collection. Only for small collections (discovery). */
    async listDocs(collectionPath, pageSize = 100) {
      const page = await request(
        'GET',
        `${base}/${encodePath(collectionPath)}?pageSize=${pageSize}`,
      );
      return (page?.documents ?? []).map((doc) => ({
        id: doc.name.split('/').at(-1),
        data: decodeFields(doc.fields ?? {}),
      }));
    },

    /**
     * Every document of a collection (all pages), decoded, with ids. `fields` limits which fields
     * come back (a field mask), so a scan of big documents stays cheap.
     */
    async listAllDocs(collectionPath, { fields } = {}) {
      const docs = [];
      let pageToken = '';
      do {
        const query = new URLSearchParams({ pageSize: '300' });
        for (const field of fields ?? []) query.append('mask.fieldPaths', field);
        if (pageToken) query.set('pageToken', pageToken);
        const page = await request('GET', `${base}/${encodePath(collectionPath)}?${query}`);
        for (const doc of page?.documents ?? []) {
          docs.push({ id: doc.name.split('/').at(-1), data: decodeFields(doc.fields ?? {}) });
        }
        pageToken = page?.nextPageToken ?? '';
      } while (pageToken);
      return docs;
    },

    async listCollectionIds(docPath) {
      const ids = [];
      let pageToken = '';
      do {
        const page = await request('POST', `${base}/${encodePath(docPath)}:listCollectionIds`, {
          pageSize: 100,
          ...(pageToken ? { pageToken } : {}),
        });
        ids.push(...(page?.collectionIds ?? []));
        pageToken = page?.nextPageToken ?? '';
      } while (pageToken);
      return ids;
    },

    /**
     * Apply writes in one atomic commit: `{op: 'set', path, data}` replaces the whole document,
     * `{op: 'delete', path}` removes it, and `{op: 'patch', path, data}` changes only the top-level
     * fields in `data` of a document that must already exist (nothing else is touched or created).
     * Callers keep each commit under 500 writes.
     */
    async commit(writes) {
      if (writes.length === 0) return;
      const body = {
        writes: writes.map((w) => {
          if (w.op === 'delete') return { delete: `${root}/${w.path}` };
          if (w.op === 'patch') {
            return {
              update: { name: `${root}/${w.path}`, fields: encodeFields(w.data) },
              updateMask: { fieldPaths: Object.keys(w.data) },
              currentDocument: { exists: true },
            };
          }
          return { update: { name: `${root}/${w.path}`, fields: encodeFields(w.data) } };
        }),
      };
      const result = await request('POST', `${origin}/v1/${root}:commit`, body);
      if (result === null)
        throw new Error(`Firestore commit failed: project "${project}" not found`);
    },
  };
}
