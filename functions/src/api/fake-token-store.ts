import type { AccountStatus } from '@atrium/shared';
import type { ApiTokenDoc, ApiTokenIndexDoc, ApiTokenRef, ApiTokenStore } from './token-store';

/** In-memory `ApiTokenStore` for unit tests. Not bundled: nothing under `src/index.ts` imports it. */
export class FakeApiTokenStore implements ApiTokenStore {
  /** Key `uid/tokenId`. */
  tokens = new Map<string, ApiTokenDoc>();
  index = new Map<string, ApiTokenIndexDoc>();
  accounts = new Map<string, AccountStatus>();
  /** Key `uid`, the workspace ids the person belongs to. */
  memberships = new Map<string, Set<string>>();
  reads = { index: 0, token: 0, account: 0 };
  touches: Array<{ uid: string; tokenId: string; now: number }> = [];
  failTouch = false;
  private nextId = 1;

  getIndex(hash: string) {
    this.reads.index += 1;
    return Promise.resolve(this.index.get(hash) ?? null);
  }
  getToken(uid: string, tokenId: string) {
    this.reads.token += 1;
    return Promise.resolve(this.tokens.get(`${uid}/${tokenId}`) ?? null);
  }
  listUnrevokedTokens(uid: string) {
    const out: ApiTokenRef[] = [];
    for (const [key, doc] of this.tokens) {
      const [owner, tokenId] = key.split('/');
      if (owner === uid && doc.revokedAt === null) out.push({ uid, tokenId: tokenId!, doc });
    }
    return Promise.resolve(out);
  }
  getAccountStatus(uid: string) {
    this.reads.account += 1;
    return Promise.resolve(this.accounts.get(uid) ?? null);
  }
  isWorkspaceMember(uid: string, workspaceId: string) {
    return Promise.resolve(this.memberships.get(uid)?.has(workspaceId) ?? false);
  }
  createTokenIfRoom(args: Parameters<ApiTokenStore['createTokenIfRoom']>[0]) {
    const active = [...this.tokens.entries()].filter(
      ([key, doc]) =>
        key.startsWith(`${args.uid}/`) && doc.revokedAt === null && doc.expiresAt > args.now,
    );
    if (active.length >= args.maxActive) return Promise.resolve(false);
    this.tokens.set(`${args.uid}/${args.tokenId}`, { ...args.doc });
    this.index.set(args.hash, { ...args.index });
    return Promise.resolve(true);
  }
  revokeToken(uid: string, tokenId: string, now: number) {
    const doc = this.tokens.get(`${uid}/${tokenId}`);
    if (doc) doc.revokedAt = now;
    for (const [hash, entry] of this.index) {
      if (entry.uid === uid && entry.tokenId === tokenId) this.index.delete(hash);
    }
    return Promise.resolve();
  }
  touchLastUsed(uid: string, tokenId: string, now: number) {
    if (this.failTouch) return Promise.reject(new Error('touch failed'));
    this.touches.push({ uid, tokenId, now });
    const doc = this.tokens.get(`${uid}/${tokenId}`);
    if (doc) doc.lastUsedAt = now;
    return Promise.resolve();
  }
  newId() {
    return `tok${this.nextId++}`;
  }
}
