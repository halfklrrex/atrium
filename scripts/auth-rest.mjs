// A tiny Firebase Auth admin client over the Identity Toolkit REST API: no SDK, no new dependency, no
// service-account key. Used by the site-admin scripts (account-claims backfill, admin grant).
//
// Endpoints (project-scoped admin API, v1):
//   List users:    GET  {origin}/v1/projects/{project}/accounts:batchGet?maxResults=1000[&nextPageToken=...]
//   Set claims:    POST {origin}/v1/projects/{project}/accounts:update   { localId, customAttributes }
//                  (`customAttributes` is the claims object serialised as a JSON string)
//
// - Production: origin `https://identitytoolkit.googleapis.com`, `Authorization: Bearer <gcloud
//   auth print-access-token>`, and the quota-project header `x-goog-user-project: <project>`
//   (user credentials need one; `--no-quota-project` leaves it out).
// - Emulator: origin `http://<FIREBASE_AUTH_EMULATOR_HOST | this copy's auth port>/identitytoolkit.googleapis.com`
//   with the emulator's rules-bypassing `Bearer owner` token.
import { portOffset, ports } from './env.mjs';

const PRODUCTION_ORIGIN = 'https://identitytoolkit.googleapis.com';
const SERVER_ERRORS = new Set([429, 500, 502, 503, 504]);
const PAGE_SIZE = 1000;

/** The Auth emulator's address; refuses anything that is not this machine. */
export function authEmulatorHost(env = process.env) {
  const host = env.FIREBASE_AUTH_EMULATOR_HOST || `127.0.0.1:${ports(portOffset()).auth}`;
  const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    throw new Error(
      `FIREBASE_AUTH_EMULATOR_HOST is "${host}", which is not a local address. Refusing to continue.`,
    );
  }
  return host;
}

/**
 * @param {object} options
 * @param {string} options.origin
 * @param {string} options.project
 * @param {() => Promise<string>|string} options.getToken
 * @param {string} [options.quotaProject]
 * @param {typeof fetch} [options.fetch]
 */
export function createAuthRest({ origin, project, getToken, quotaProject, fetch: f = fetch }) {
  const base = `${origin}/v1/projects/${project}`;

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
      if (response.ok) return response.json();
      if (SERVER_ERRORS.has(response.status) && attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
        continue;
      }
      // Never echo the response body: it can contain account details.
      throw Object.assign(
        new Error(`Auth ${method} ${url.replace(origin, '')} -> ${response.status}`),
        { status: response.status },
      );
    }
  }

  return {
    describe: `${origin} (project ${project}, Auth)`,
    project,

    /** One page of users: `{ users: [{ uid, customClaims, disabled }], nextPageToken }`. */
    async listUsers(pageToken) {
      const query = new URLSearchParams({ maxResults: String(PAGE_SIZE) });
      if (pageToken) query.set('nextPageToken', pageToken);
      const page = await request('GET', `${base}/accounts:batchGet?${query}`);
      return {
        users: (page.users ?? []).map((u) => ({
          uid: u.localId,
          customClaims: u.customAttributes ? JSON.parse(u.customAttributes) : {},
          disabled: Boolean(u.disabled),
        })),
        nextPageToken: page.nextPageToken || undefined,
      };
    },

    /** One user by uid, or `null` when there is none. */
    async getUser(uid) {
      const result = await request('POST', `${base}/accounts:lookup`, { localId: [uid] });
      const u = result.users?.[0];
      if (!u) return null;
      return {
        uid: u.localId,
        customClaims: u.customAttributes ? JSON.parse(u.customAttributes) : {},
        disabled: Boolean(u.disabled),
      };
    },

    /** Replaces the user's custom claims (callers merge first). */
    async setCustomClaims(uid, claims) {
      await request('POST', `${base}/accounts:update`, {
        localId: uid,
        customAttributes: JSON.stringify(claims),
      });
    },
  };
}

/** Auth client for a resolved target (`{ target, project, quotaProject }`). */
export function createAuthClient(options, { getToken } = {}) {
  if (options.target === 'emulator') {
    return createAuthRest({
      origin: `http://${authEmulatorHost()}/identitytoolkit.googleapis.com`,
      project: options.project,
      getToken: () => 'owner',
    });
  }
  let token;
  return createAuthRest({
    origin: PRODUCTION_ORIGIN,
    project: options.project,
    quotaProject: options.quotaProject,
    getToken: () => (token ??= getToken()),
  });
}
