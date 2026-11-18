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
  /** When set, only this workspace, or these (a restricted API token), and their boards are visible; an empty list shows none. */
  workspaceFilter?: string | string[] | null;
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
  /** The board an item or subitem lives on; `boardId` is an optional hint. Missing and unreadable are the same error. */
  locateItem(args: { itemId: string; boardId?: string }): Promise<{ boardId: string }>;
  /** One item or subitem with cells keyed by column id (`values`) and title (`valuesByTitle`), subitems nested. */
  getItem(args: { itemId: string; boardId?: string }): Promise<Record<string, unknown>>;
  findItems(args: {
    boardId: string;
    name?: string;
    group?: string;
    where?: { column: string; equals: string | number | boolean | null }[];
    limit?: number;
    offset?: number;
    /** Key each row's values by `Title (columnId)` when two columns share a title (as getBoard does). */
    uniqueTitles?: boolean;
  }): Promise<{
    total: number;
    offset: number;
    shown: number;
    items: Record<string, unknown>[];
    nextOffset?: number;
    notes?: string[];
  }>;
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
  listDocs(args?: { workspaceId?: string; state?: 'active' | 'deleted' }): Promise<{
    workspaceId: string;
    docs: {
      id: string;
      name: string;
      kind: string;
      role: string;
      state: string;
      updatedAt: string | null;
    }[];
  }>;
  getDoc(args: { docId: string }): Promise<Record<string, unknown>>;
  createDoc(args: {
    name: string;
    workspaceId?: string;
    kind?: 'main' | 'private' | 'shareable';
    markdown?: string;
  }): Promise<{
    id: string;
    workspaceId: string;
    name: string;
    kind: string;
    rev: number;
    mentioned: number;
  }>;
  writeDoc(args: {
    docId: string;
    markdown: string;
    mode?: 'replace' | 'append';
    baseRev?: number;
    allowOverwriteRich?: boolean;
  }): Promise<{ id: string; mode: string; rev: number; chars: number; mentioned: number }>;
  renameDoc(args: { docId: string; name: string }): Promise<{ id: string; name: string }>;
  deleteDoc(args: { docId: string }): Promise<{ id: string; name: string; state: string }>;
  restoreDoc(args: { docId: string }): Promise<{ id: string; name: string; state: string }>;
  createTeam(args: {
    workspaceId?: string;
    name: string;
    color?: string;
    members?: string[];
  }): Promise<{ workspaceId: string; team: TeamSummary }>;
  updateTeam(args: {
    workspaceId?: string;
    team: string;
    name?: string;
    color?: string;
    addMembers?: string[];
    removeMembers?: string[];
  }): Promise<{ workspaceId: string; team: TeamSummary; droppedFormerMembers?: string[] }>;
  deleteTeam(args: {
    workspaceId?: string;
    team: string;
    dryRun?: boolean;
    allowDataLoss?: boolean;
  }): Promise<{
    workspaceId: string;
    team: TeamSummary;
    assignedItems: number;
    boards: { boardId: string; name: string; items: number }[];
    needsAllowDataLoss: boolean;
    dryRun: boolean;
    deleted: boolean;
  }>;
  editLabels(args: {
    boardId: string;
    column: string;
    rename?: { from: string; to: string }[];
    recolor?: { label: string; color: string }[];
    order?: string[];
    remove?: string[];
    dryRun?: boolean;
    allowDataLoss?: boolean;
  }): Promise<{
    id: string;
    title: string;
    type: string;
    renamed: { from: string; to: string }[];
    recolored: { label: string; color: string }[];
    removed: { label: string; items: number }[];
    itemsCleared?: number;
    itemsAffected?: number;
    needsAllowDataLoss?: boolean;
    dryRun?: boolean;
    warning?: string;
    [key: string]: unknown;
  }>;
  /** Startup check: the user exists (and is a member of the filter workspace, when set). */
  verify(): Promise<{ uid: string; workspaces: WorkspaceSummary[] }>;
  /** False when built without `serverOps`: the tools marked `requires: 'server'` are not registered. */
  hasServerOps?: boolean;
  listFiles(args: {
    boardId: string;
    itemId?: string;
    column?: string;
    includeUpdates?: boolean;
  }): Promise<Record<string, unknown>>;
  getFileLink(args: FileTarget): Promise<Record<string, unknown>>;
  uploadFile(args: {
    boardId: string;
    itemId: string;
    column?: string;
    name: string;
    contentType: string;
    dataBase64: string;
  }): Promise<Record<string, unknown>>;
  deleteFile(args: FileTarget): Promise<Record<string, unknown>>;
  setAccess(args: {
    target: 'board' | 'doc' | 'dashboard';
    id: string;
    kind?: 'main' | 'private' | 'shareable';
    person?: { who: string; role: 'owner' | 'editor' | 'viewer' | null };
    dryRun?: boolean;
    allowDataLoss?: boolean;
  }): Promise<Record<string, unknown>>;
  changeColumnType(args: {
    boardId: string;
    column: string;
    toType: string;
    settings?: Record<string, unknown>;
    dryRun?: boolean;
    allowDataLoss?: boolean;
  }): Promise<Record<string, unknown>>;
  revertColumnType(args: { boardId: string; column: string }): Promise<Record<string, unknown>>;
  clickButton(args: {
    boardId: string;
    itemId: string;
    column?: string;
  }): Promise<Record<string, unknown>>;
  startTimeTracking(args: {
    boardId: string;
    itemId: string;
    column?: string;
  }): Promise<Record<string, unknown>>;
  stopTimeTracking(args: {
    boardId: string;
    itemId: string;
    column?: string;
  }): Promise<Record<string, unknown>>;
}

/** Which file a tool means: a Files column cell, or an update or reply attachment. */
export interface FileTarget {
  boardId: string;
  itemId: string;
  fileId: string;
  column?: string;
  updateId?: string;
  replyId?: string;
}

/** A stored file's metadata, as the Files column and update attachments keep it. */
export interface StoredFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  uploadedBy: string;
}

/**
 * Operations that need Cloud Storage and the file callables' library code. Only the hosted Function
 * provides them (`functions/src/mcp/server-ops.ts`); every method acts as `uid`, runs the callables'
 * own permission checks again and rejects with `McpUserError` for a problem the caller can fix.
 */
export interface SharingState {
  kind: 'main' | 'private' | 'shareable';
  access: Record<string, 'owner' | 'editor' | 'viewer'>;
}

/** What a column type change would do to the column's current values (nothing is written). */
export interface ColumnTypeChangePreview {
  fromType: string;
  toType: string;
  toSettings: Record<string, unknown>;
  converted: number;
  cleared: number;
  /** Values that would be cleared, as text, with their item (at most 25). */
  lost: Array<{ itemId: string; before: string }>;
  samples: Array<{ before: string; after: string | null }>;
}

export interface ServerOps {
  /** The change callable's checks and conversion on the live values, without writing. */
  previewColumnTypeChange(args: {
    uid: string;
    boardId: string;
    columnId: string;
    toType: string;
    toSettings: Record<string, unknown>;
  }): Promise<ColumnTypeChangePreview>;
  /** `changeColumnType`'s library logic (snapshot, convert, finish) for a top-level column. */
  changeColumnType(args: {
    uid: string;
    boardId: string;
    columnId: string;
    toType: string;
    toSettings: Record<string, unknown>;
  }): Promise<{ converted: number; cleared: number; snapshotId: string; toType: string }>;
  /** `revertColumnType`'s library logic. */
  revertColumnType(args: {
    uid: string;
    boardId: string;
    snapshotId: string;
  }): Promise<{ restored: number; removed: number; snapshotId: string; columnId: string }>;
  /** `clickButton`'s code: the button's actions, then its notifications. */
  clickButton(args: { uid: string; boardId: string; itemId: string; columnId: string }): Promise<{
    activityId: string;
    timestamp: number;
    applied: Array<{ type: string }>;
    notified?: number;
  }>;
  startTimeTracking(args: {
    uid: string;
    boardId: string;
    itemId: string;
    columnId: string;
  }): Promise<{ sessionId: string; startedAt: number }>;
  stopTimeTracking(args: {
    uid: string;
    boardId: string;
    itemId: string;
    columnId: string;
  }): Promise<{ duration: number; stoppedAt: number }>;
  /**
   * Changes a board, doc or dashboard's sharing with the sharing callables' library code, acting as
   * `uid`. `dryRun` runs the same checks and reports the states without writing. `roles` is the
   * workspace's member roles (who counts as a member).
   */
  setAccess(args: {
    uid: string;
    target: 'board' | 'doc' | 'dashboard';
    id: string;
    kind?: 'main' | 'private' | 'shareable';
    person?: { uid: string; role: 'owner' | 'editor' | 'viewer' | null };
    dryRun?: boolean;
  }): Promise<{
    before: SharingState;
    after: SharingState;
    roles: Record<string, 'owner' | 'admin' | 'member' | 'viewer'>;
  }>;
  getFileLink(args: {
    uid: string;
    boardId: string;
    itemId: string;
    fileId: string;
    columnId?: string;
    updateId?: string;
    replyId?: string;
  }): Promise<{ url: string; expiresAt: number }>;
  uploadFile(args: {
    uid: string;
    boardId: string;
    itemId: string;
    columnId: string;
    name: string;
    contentType: string;
    bytes: Uint8Array;
  }): Promise<{ file: StoredFile; filesInCell: number }>;
  deleteFile(args: {
    uid: string;
    boardId: string;
    itemId: string;
    fileId: string;
    columnId?: string;
    updateId?: string;
    replyId?: string;
  }): Promise<{ remaining: number }>;
}

export declare function createService(options: {
  client: FirestoreClient;
  actor: Actor;
  now?: () => Date;
  /** Provided by the hosted Function only; without it the hosted-only tools are not registered. */
  serverOps?: ServerOps;
  /** The public API sets this: names never fall back to an email address and email fields are omitted. */
  hideEmails?: boolean;
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
  /** `'server'`: needs `serverOps`, so only the hosted connector registers it. */
  requires?: 'server';
  annotations: ToolAnnotations;
  run(args: Record<string, unknown>): Promise<unknown>;
}

/** The tool catalogue bound to a service. */
export declare function defineTools(service: McpService): ToolDefinition[];

/** The tool names of each domain file (boards, items, updates, members, docs), for the count tests and docs. */
export declare function toolNamesByDomain(service?: Partial<McpService>): Record<string, string[]>;

/** The names of the tools only the hosted connector registers (`requires: 'server'`). */
export declare function serverToolNames(): string[];

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
export declare function resolveMentions(
  doc: Record<string, unknown>,
  resolve: (ref: string) => { uid: string; name: string },
): { doc: Record<string, unknown>; mentions: string[] };
