import { slugify } from '@atrium/shared';

/**
 * A document as far as a path needs it. Without a name (a caller that only has an id, such as a
 * notification) the bare-id form is built; the page canonicalises it once it has loaded.
 */
export interface DocRef {
  id: string;
  name?: string;
}
export type BoardRef = DocRef;

const param = (ref: DocRef, fallback: string): string =>
  ref.name === undefined ? ref.id : `${slugify(ref.name, fallback)}-${ref.id}`;

/**
 * The id inside a `:boardId` / `:workspaceId` / `:dashboardId` route param. Params are
 * `<slug>-<id>` (the slug is never trusted) or a bare id; Firestore auto ids never contain `-`,
 * so the id is the text after the last dash.
 */
export function idFromSlugParam(value: string | undefined): string {
  if (!value) return '';
  return value.slice(value.lastIndexOf('-') + 1);
}

/** The route param for a document: `q4-roadmap-<id>`. */
export const boardParam = (b: DocRef): string => param(b, 'board');
export const workspaceParam = (w: DocRef): string => param(w, 'workspace');
export const dashboardParam = (d: DocRef): string => param(d, 'dashboard');

/** `/boards/<slug>-<id>` plus an optional suffix such as `/views/:viewId` or `/items/:itemId`. */
export const boardPath = (board: DocRef, rest = ''): string =>
  `/boards/${boardParam(board)}${rest}`;
export const workspacePath = (workspace: DocRef, rest = ''): string =>
  `/workspaces/${workspaceParam(workspace)}${rest}`;
export const dashboardPath = (dashboard: DocRef): string =>
  `/dashboards/${dashboardParam(dashboard)}`;
