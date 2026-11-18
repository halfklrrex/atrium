import {
  API_TOKEN_DEFAULT_EXPIRY_DAYS,
  API_TOKEN_DISPLAY_PREFIX_LENGTH,
  API_TOKEN_NAME_MAX,
  type ApiTokenScope,
  type CreateApiTokenRequest,
} from '@atrium/shared';
import type { ApiTokenDoc } from '../../data';
import { describeLastUsed } from './connected-apps';

const LOCALE = 'en-US';

export type ExpiryDays = CreateApiTokenRequest['expiresInDays'];

export const EXPIRY_OPTIONS: ReadonlyArray<{ days: ExpiryDays; label: string }> = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
];
export const DEFAULT_EXPIRY_DAYS: ExpiryDays = API_TOKEN_DEFAULT_EXPIRY_DAYS;

export type AccessChoice = 'read' | 'write';

export function scopesForAccess(access: AccessChoice): ApiTokenScope[] {
  return access === 'write' ? ['read', 'write'] : ['read'];
}

export function describeScopes(scopes: readonly ApiTokenScope[]): string {
  return scopes.includes('write') ? 'Read and write' : 'Read';
}

function fullDate(ms: number): string {
  return new Date(ms).toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** The stored display prefix (the first characters of the token) with an ellipsis. */
export function describePrefix(prefix: string): string {
  return `${prefix.slice(0, API_TOKEN_DISPLAY_PREFIX_LENGTH)}…`;
}

/** "All workspaces", or the names of the restricted workspaces (unknown ones are counted only). */
export function describeWorkspaces(
  workspaceIds: readonly string[] | null,
  names: ReadonlyMap<string, string>,
): string {
  if (!workspaceIds || workspaceIds.length === 0) return 'All workspaces';
  const known = workspaceIds.map((id) => names.get(id)).filter((n): n is string => !!n);
  const count = `${workspaceIds.length} ${workspaceIds.length === 1 ? 'workspace' : 'workspaces'}`;
  return known.length === workspaceIds.length ? `${count}: ${known.join(', ')}` : count;
}

export function isExpired(token: ApiTokenDoc, now: number = Date.now()): boolean {
  return token.expiresAt.toMillis() <= now;
}

/** One line under the token name: scopes, restriction, created, last used and expiry. */
export function describeToken(
  token: ApiTokenDoc,
  names: ReadonlyMap<string, string>,
  now: number = Date.now(),
): string {
  const lastUsed = token.lastUsedAt ? describeLastUsed(token.lastUsedAt.toMillis(), now) : 'never';
  const expiry = isExpired(token, now)
    ? `expired ${fullDate(token.expiresAt.toMillis())}`
    : `expires ${fullDate(token.expiresAt.toMillis())}`;
  return [
    describeScopes(token.scopes),
    describeWorkspaces(token.workspaceIds, names),
    `created ${fullDate(token.createdAt.toMillis())}`,
    `last used ${lastUsed}`,
    expiry,
  ].join(' · ');
}

export type CreateForm = {
  name: string;
  access: AccessChoice;
  restrict: boolean;
  workspaceIds: string[];
  expiresInDays: ExpiryDays;
};

export const EMPTY_CREATE_FORM: CreateForm = {
  name: '',
  access: 'read',
  restrict: false,
  workspaceIds: [],
  expiresInDays: DEFAULT_EXPIRY_DAYS,
};

export type ParsedCreateForm =
  { ok: true; request: CreateApiTokenRequest } | { ok: false; message: string };

export function parseCreateForm(form: CreateForm): ParsedCreateForm {
  const name = form.name.trim();
  if (!name) return { ok: false, message: 'Give the token a name.' };
  if (name.length > API_TOKEN_NAME_MAX) {
    return { ok: false, message: `Use ${API_TOKEN_NAME_MAX} characters or fewer.` };
  }
  if (form.restrict && form.workspaceIds.length === 0) {
    return { ok: false, message: 'Pick at least one workspace, or allow all workspaces.' };
  }
  return {
    ok: true,
    request: {
      name,
      scopes: scopesForAccess(form.access),
      ...(form.restrict ? { workspaceIds: form.workspaceIds } : {}),
      expiresInDays: form.expiresInDays,
    },
  };
}
