// Hand-written types for @atrium/mcp-core (the implementation is plain ESM in `.mjs` files).
// They describe the surface the hosted Function and the stdio server use; the builders and
// converters are typed loosely because their inputs are the connector's own plain-JSON shapes.
import type { ZodType } from 'zod';

/** A problem the caller can fix (bad input, wrong board, no permission). Shown as a plain message. */
export declare class McpUserError extends Error {
  constructor(message: string);
}

/** Ids that tools accept: a plain id, never a path. */
export declare const ID_PATTERN: RegExp;
export declare function assertId(value: unknown, what: string): string;

export declare const MAX_ITEMS_PER_CALL: number;
export declare const CREATABLE_COLUMN_TYPES: readonly string[];

/** A Firestore document with its id and `updateTime` (an opaque precondition token). */
export interface DocRow<T = Record<string, unknown>> {
  id: string;
  data: T;
  updateTime: string;
}

/**
 * `{ field: value }` for equality, `{ field: { arrayContains: value } }` for array membership and
 * `{ field: { arrayContainsAny: [values] } }` for array overlap (1 to 30 values).
 */
export type QueryWhere = Record<
  string,
  unknown | { arrayContains: unknown } | { arrayContainsAny: unknown[] }
>;

/** `limit`, and `orderBy` (only without filters, so no composite index is ever needed). */
export interface QueryOptions {
  limit?: number;
  orderBy?: { field: string; direction?: 'asc' | 'desc' };
}

export type Precondition = { exists: boolean } | { updateTime: string };

export type Write =
  | { op: 'set'; path: string; data: Record<string, unknown>; precondition?: Precondition }
  | { op: 'patch'; path: string; data: Record<string, unknown>; precondition?: Precondition }
  | {
      op: 'update';
      path: string;
      set?: Record<string, unknown>;
      remove?: string[];
      increment?: Record<string, number>;
      serverTimestamp?: string[];
      precondition?: Precondition;
    }
  | { op: 'delete'; path: string; precondition?: Precondition };

/**
 * What the service needs from Firestore. Implemented by the REST client
 * (`scripts/showcase/firestore-rest.mjs`), the Admin SDK adapter in the Function, and the fake.
 * Timestamps come back as `Date`; values with `toMillis()` (or `Date`) go in as timestamps.
 * A failed precondition rejects with an error whose `status` is 409 (or 400).
 */
export interface FirestoreClient {
  getDoc(path: string): Promise<Record<string, unknown> | null>;
  getDocMeta(path: string): Promise<{ data: Record<string, unknown>; updateTime: string } | null>;
  listAllDocs(collectionPath: string, options?: { fields?: string[] }): Promise<DocRow[]>;
  /** `collectionPath` may be nested (`boards/{id}/items`). */
  runQuery(collectionPath: string, where?: QueryWhere, options?: QueryOptions): Promise<DocRow[]>;
  commit(writes: Write[]): Promise<void>;
}

/** Who the service acts as: an Atrium user, optionally limited to one workspace. */
export interface Actor {
  uid: string;
  /** When set, only this workspace (and its boards) is visible; the actor must be a member. */
  workspaceFilter?: string | null;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: string;
}

export interface MemberSummary {
  uid: string;
  name: string;
  email: string | null;
  role?: string;
  workspaceRole?: string | null;
  me?: boolean;
  /** Shared profile fields the person has set (from the member doc). */
  title?: string;
  location?: string;
  timeZone?: string;
}

export interface TeamSummary {
  id: string;
  name: string;
  color: string | null;
  members: { uid: string; name: string }[];
}

/** The tool logic. Every method takes plain JSON and returns plain JSON or rejects with `McpUserError`. */
export interface McpService {
  listWorkspaces(): Promise<{ workspaces: WorkspaceSummary[] }>;
  listBoards(args?: { workspaceId?: string; state?: 'active' | 'archived' | 'deleted' }): Promise<{
    workspaceId: string;
    boards: { id: string; name: string; kind: string; state: string }[];
  }>;
  getBoard(args: {
    boardId: string;
    includeItems?: boolean;
    limit?: number;
  }): Promise<Record<string, unknown>>;
  listTemplates(args?: { workspaceId?: string }): Promise<{
    workspaceId: string;
    templates: {
      id: string;
      source: 'built-in' | 'workspace';
      name: string;
      description: string;
      columns: { title: string; type: string }[];
      groups: string[];
      sampleItems: number;
    }[];
  }>;
  createBoard(args: {
    name: string;
    description?: string;
    workspaceId?: string;
    templateId?: string;
    includeSampleItems?: boolean;
  }): Promise<Record<string, unknown>>;
  addGroup(args: { boardId: string; title: string; color?: string }): Promise<unknown>;
  renameGroup(args: { boardId: string; group: string; title: string }): Promise<unknown>;
  deleteGroup(args: { boardId: string; group: string }): Promise<unknown>;
  addColumn(args: {
    boardId: string;
    title: string;
    type: string;
    settings?: Record<string, unknown>;
  }): Promise<unknown>;
  updateColumnSettings(args: {
    boardId: string;
    column: string;
    settings: Record<string, unknown>;
  }): Promise<unknown>;
  createItems(args: {
    boardId: string;
    items: { name: string; group?: string; values?: Record<string, unknown> }[];
  }): Promise<{ created: { id: string; name: string; group: string }[] }>;
  updateItem(args: {
    boardId: string;
    itemId: string;
    name?: string;
    group?: string;
    values?: Record<string, unknown>;
  }): Promise<{ id: string; updated: string[] }>;
  restoreItem(args: { boardId: string; itemId: string }): Promise<unknown>;
  moveItem(args: {
    boardId: string;
    itemId: string;
    group?: string;
    position?: 'first' | 'last';
    beforeItemId?: string;
    afterItemId?: string;
  }): Promise<unknown>;
  reorderGroups(args: { boardId: string; groups: string[] }): Promise<unknown>;
  setUpdateLike(args: {
    boardId: string;
    itemId: string;
    updateId: string;
    replyId?: string;
    liked: boolean;
  }): Promise<unknown>;
  setVote(args: {
    boardId: string;
    itemId: string;
    column?: string;
    voted: boolean;
  }): Promise<unknown>;
  renameBoard(args: { boardId: string; name?: string; description?: string }): Promise<unknown>;
  setBoardState(args: { boardId: string; to: 'active' | 'archived' | 'deleted' }): Promise<unknown>;
  findMember(args: { email: string; workspaceId?: string }): Promise<unknown>;
  getItemDescription(args: { boardId: string; itemId: string }): Promise<unknown>;
  setItemDescription(args: {
    boardId: string;
    itemId: string;
    markdown: string;
    mode?: 'replace' | 'append';
    allowOverwriteRich?: boolean;
  }): Promise<unknown>;
  setItemState(args: {
    boardId: string;
    itemId: string;
    state: 'archived' | 'deleted';
  }): Promise<unknown>;
  listUpdates(args: {
    boardId: string;
    itemId: string;
    limit?: number;
    includeReplies?: boolean;
  }): Promise<unknown>;
  addUpdate(args: { boardId: string; itemId: string; text: string }): Promise<unknown>;
  addReply(args: {
    boardId: string;
    itemId: string;
    updateId: string;
    text: string;
  }): Promise<unknown>;
  editUpdate(args: {
    boardId: string;
    itemId: string;
    updateId: string;
    replyId?: string;
    text: string;
  }): Promise<unknown>;
  deleteUpdate(args: {
    boardId: string;
    itemId: string;
    updateId: string;
    replyId?: string;
  }): Promise<unknown>;
  listSubitems(args: { boardId: string; itemId: string }): Promise<unknown>;
  createSubitems(args: {
    boardId: string;
    itemId: string;
    subitems: { name: string; values?: Record<string, unknown> }[];
  }): Promise<unknown>;
  duplicateItem(args: { boardId: string; itemId: string }): Promise<unknown>;
  moveItemToBoard(args: {
    boardId: string;
    itemId: string;
    targetBoardId: string;
    group?: string;
    dryRun?: boolean;
    allowDataLoss?: boolean;
  }): Promise<{
    newItemId: string | null;
    targetBoardId: string;
    group: string;
    copied: { from: string; to: string }[];
    dropped: { column: string; reason: string }[];
    subitems: number;
    updatesLeftOnSource: number;
    sourceState: 'deleted';
    dryRun: boolean;
    needsAllowDataLoss: boolean;
  }>;
  getActivity(args: { boardId: string; itemId?: string; limit?: number }): Promise<unknown>;
  listMembers(args?: {
    boardId?: string;
    workspaceId?: string;
  }): Promise<{ workspaceId: string; members: MemberSummary[] }>;
  listTeams(args?: {
    workspaceId?: string;
  }): Promise<{ workspaceId: string; teams: TeamSummary[] }>;
  /** Startup check: the user exists (and is a member of the filter workspace, when set). */
  verify(): Promise<{ uid: string; workspaces: WorkspaceSummary[] }>;
}

export declare function createService(options: {
  client: FirestoreClient;
  actor: Actor;
  now?: () => Date;
}): McpService;

export type ToolScope = 'read' | 'write';

/** MCP tool annotations (hints for the client; never relied on for safety). */
export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** A zod raw shape (`{ field: ZodType }`), as `McpServer.registerTool` takes it. */
  inputSchema: Record<string, ZodType>;
  /** Read tools work on a read-only connection; write tools need `atrium:write`. */
  scope: ToolScope;
  annotations: ToolAnnotations;
  run(args: Record<string, unknown>): Promise<unknown>;
}

/** The tool catalogue bound to a service. */
export declare function defineTools(service: McpService): ToolDefinition[];

/** The tool names of each domain file (boards, items, updates, members), for the count tests and docs. */
export declare function toolNamesByDomain(service?: Partial<McpService>): Record<string, string[]>;

// ---- lower-level helpers (used by tests and the hosted server's own checks) ----------------------

export declare function findColumn<T extends { id: string; title: string }>(
  board: { columns: T[] },
  ref: string,
): T;
export declare function findGroup<T extends { id: string; title: string }>(
  board: { groups: T[] },
  ref: string,
): T;
export declare function sortedByPosition<T extends { position: string }>(list: T[]): T[];

export declare function convertCellValue(
  column: Record<string, unknown>,
  input: unknown,
  ctx: {
    uid: string;
    memberUids: string[];
    emailToUid?: Map<string, string>;
    teams?: { id: string; name: string }[];
  },
): unknown;
export declare function toValidCell(
  column: Record<string, unknown>,
  input: unknown,
  ctx: {
    uid: string;
    memberUids: string[];
    emailToUid?: Map<string, string>;
    teams?: { id: string; name: string }[];
  },
): unknown;
/** Context for calculated columns (`boardId`, `item`, `columns`) and for naming people and teams. */
export interface ReadableCellContext {
  boardId?: string;
  item?: Record<string, unknown>;
  columns?: readonly Record<string, unknown>[];
  /** uid -> name */
  people?: Map<string, string>;
  /** team id -> team (`{ name }`) */
  teams?: Map<string, { name: string }>;
}
export declare function readableCell(
  column: Record<string, unknown>,
  value: unknown,
  ctx?: ReadableCellContext,
): unknown;

export declare const LABEL_COLORS: Record<string, string>;
export declare function resolveColor(color: unknown, fallbackIndex?: number): string;
/** A Timestamp stand-in (`seconds`, `nanoseconds`, `toDate()`, `toMillis()`). */
export declare function ts(date: Date): {
  seconds: number;
  nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
};
export declare function newDocId(): string;
export declare function newSlugId(length?: number): string;
export declare function positionAfter(positions: string[]): string;
export declare function positionRightAfter(positions: string[], current: string): string;
export declare function addLabelsToSettings(
  type: string,
  settings: Record<string, unknown>,
  additions: unknown,
): Record<string, unknown>;
export declare function validSettings(
  type: string,
  settings: Record<string, unknown>,
): Record<string, unknown>;
export declare function buildColumnSettings(
  type: string,
  input?: Record<string, unknown>,
): Record<string, unknown>;
export declare function buildBoardDoc(input: {
  workspaceId: string;
  uid: string;
  name: string;
  description?: string;
  position: string;
  now: Date;
  newId?: () => string;
}): Record<string, unknown>;
export declare function buildGroup(input: {
  title: string;
  color?: string;
  existingGroups: { position: string }[];
  newId?: () => string;
}): Record<string, unknown>;
export declare function buildColumn(input: {
  title: string;
  type: string;
  settings?: Record<string, unknown>;
  existingColumns: { position: string }[];
  newId?: () => string;
}): Record<string, unknown>;
export declare function buildItemDoc(input: {
  uid: string;
  name: string;
  groupId: string;
  position: string;
  values: Record<string, unknown>;
  now: Date;
  parentItemId?: string | null;
}): Record<string, unknown>;
export declare function buildItemPatch(input: {
  uid: string;
  now: Date;
  name?: string;
  groupId?: string;
  position?: string;
  cells?: Record<string, unknown>;
}): { set: Record<string, unknown>; remove: string[] };
export declare function buildUpdateDoc(input: Record<string, unknown>): Record<string, unknown>;
export declare function buildReplyDoc(input: Record<string, unknown>): Record<string, unknown>;

export declare const MAX_MARKDOWN_CHARS: number;
export declare function markdownToDoc(markdown: string): Record<string, unknown>;
export declare function docToMarkdown(doc: unknown): string;
export declare function richNodeTypes(doc: unknown): string[];
export declare function toStoredDescription(doc: unknown): { doc: unknown; text: string } | null;
export declare function appendDoc(existing: unknown, addition: unknown): Record<string, unknown>;

export declare function buildRichBody(
  markdown: string,
  resolve?: (ref: string) => { uid: string; name: string },
): { content: string; contentDoc: Record<string, unknown>; mentions: string[] };
export declare function memberResolver(
  members: { uid: string; name: string; email: string | null }[],
  selfUid: string,
): (ref: string) => { uid: string; name: string; email: string | null };
