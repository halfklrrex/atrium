import type { AccountStatus } from '@atrium/shared';
import type {
  McpAuditEntry,
  McpAuthRequestDoc,
  McpClientDoc,
  McpGrantDoc,
  McpStore,
  McpTokenDoc,
  McpTx,
} from './store';

/**
 * In-memory `McpStore` for the unit tests of the provider and the consent callables (OPS4 section
 * 9: "fakes only"). Transactions run one after the other against the same maps; the emulator e2e
 * test covers Firestore's read-before-write rule. Not bundled: nothing under `src/index.ts` imports
 * it.
 */
export class FakeMcpStore implements McpStore {
  clients = new Map<string, McpClientDoc>();
  requests = new Map<string, McpAuthRequestDoc>();
  tokens = new Map<string, McpTokenDoc>();
  /** Key `uid/grantId`. */
  grants = new Map<string, McpGrantDoc>();
  accounts = new Map<string, AccountStatus>();
  audit: McpAuditEntry[] = [];
  private nextId = 1;

  getClient(clientId: string) {
    return Promise.resolve(this.clients.get(clientId) ?? null);
  }
  setClient(doc: McpClientDoc) {
    this.clients.set(doc.clientId, { ...doc });
    return Promise.resolve();
  }
  touchClient(clientId: string, lastUsedAt: number, expiresAt: number) {
    const client = this.clients.get(clientId);
    if (!client) return Promise.reject(new Error('no such client'));
    Object.assign(client, { lastUsedAt, expiresAt });
    return Promise.resolve();
  }
  createAuthRequest(requestId: string, doc: McpAuthRequestDoc) {
    if (this.requests.has(requestId)) return Promise.reject(new Error('already exists'));
    this.requests.set(requestId, { ...doc });
    return Promise.resolve();
  }
  getAuthRequest(requestId: string) {
    return Promise.resolve(this.requests.get(requestId) ?? null);
  }
  getToken(hash: string) {
    return Promise.resolve(this.tokens.get(hash) ?? null);
  }
  getAccountStatus(uid: string) {
    return Promise.resolve(this.accounts.get(uid) ?? null);
  }
  getGrant(uid: string, grantId: string) {
    return Promise.resolve(this.grants.get(`${uid}/${grantId}`) ?? null);
  }
  listActiveGrants(uid: string) {
    const out = [];
    for (const [key, doc] of this.grants) {
      const [owner, grantId] = key.split('/') as [string, string];
      if (owner === uid && doc.revokedAt === null) out.push({ uid, grantId, doc });
    }
    return Promise.resolve(out);
  }
  listGrantTokenHashes(grantId: string) {
    return Promise.resolve(
      [...this.tokens].filter(([, doc]) => doc.grantId === grantId).map(([hash]) => hash),
    );
  }
  deleteTokens(hashes: string[]) {
    for (const hash of hashes) this.tokens.delete(hash);
    return Promise.resolve();
  }
  updateGrant(uid: string, grantId: string, patch: Partial<McpGrantDoc>) {
    const grant = this.grants.get(`${uid}/${grantId}`);
    if (!grant) return Promise.reject(new Error('no such grant'));
    Object.assign(grant, patch);
    return Promise.resolve();
  }
  appendAudit(entry: McpAuditEntry) {
    this.audit.push({ ...entry });
    return Promise.resolve();
  }
  runTransaction<T>(fn: (tx: McpTx) => Promise<T>) {
    const tx: McpTx = {
      getAuthRequest: (id) => this.getAuthRequest(id),
      getToken: (hash) => this.getToken(hash),
      getGrant: (uid, id) => this.getGrant(uid, id),
      getAccountStatus: (uid) => this.getAccountStatus(uid),
      updateAuthRequest: (id, patch) => {
        const request = this.requests.get(id);
        if (!request) throw new Error('no such request');
        Object.assign(request, patch);
      },
      setToken: (hash, doc) => {
        this.tokens.set(hash, { ...doc });
      },
      updateToken: (hash, patch) => {
        const token = this.tokens.get(hash);
        if (!token) throw new Error('no such token');
        Object.assign(token, patch);
      },
      setGrant: (uid, id, doc) => {
        this.grants.set(`${uid}/${id}`, { ...doc });
      },
      updateGrant: (uid, id, patch) => {
        const grant = this.grants.get(`${uid}/${id}`);
        if (!grant) throw new Error('no such grant');
        Object.assign(grant, patch);
      },
    };
    return fn(tx);
  }
  newId() {
    return `id${String(this.nextId++).padStart(4, '0')}`;
  }

  /** Every stored string, for "raw tokens are never stored" assertions. */
  allStoredText(): string {
    return JSON.stringify([
      [...this.clients.values()],
      [...this.requests.values()],
      [...this.tokens.entries()],
      [...this.grants.entries()],
      this.audit,
    ]);
  }
}
