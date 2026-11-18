import type {
  ApiToken,
  Board,
  BoardTemplate,
  BoardView,
  Dashboard,
  DocBody,
  DocMeta,
  Favorite,
  Folder,
  IncomingHook,
  Item,
  ItemUpdate,
  McpGrant,
  Notification,
  Recent,
  Team,
  UpdateReply,
  User,
  Webhook,
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
} from '@atrium/shared';

/** A document as the UI sees it: data plus its Firestore id. */
export type WithId<T> = T & { id: string };

export type WorkspaceDoc = WithId<Workspace>;
export type FolderDoc = WithId<Folder>;
export type BoardDoc = WithId<Board>;
/** `dashboards/{id}`: a page of widgets reading live from boards. */
export type DashboardDoc = WithId<Dashboard>;
/** `docs/{id}`: the metadata of a workspace doc (its text is in `content/body`). */
export type DocMetaDoc = WithId<DocMeta>;
/** `docs/{id}/content/body`: the text of a doc, revision-checked. */
export type DocBodyDoc = DocBody;
/** `workspaces/{id}/templates/{id}`: a saved board template. */
export type TemplateDoc = WithId<BoardTemplate>;
/** A saved view; `synthetic` marks the built-in `main` view that has not been saved yet. */
export type BoardViewDoc = WithId<BoardView> & { synthetic?: boolean };
export type ItemDoc = WithId<Item>;
export type ItemUpdateDoc = WithId<ItemUpdate>;
export type UpdateReplyDoc = WithId<UpdateReply>;
export type UserDoc = WithId<User>;
export type FavoriteDoc = WithId<Favorite>;
export type RecentDoc = WithId<Recent>;
export type NotificationDoc = WithId<Notification>;
export type McpGrantDoc = WithId<McpGrant>;
/** `users/{uid}/apiTokens/{id}`: a personal access token's metadata (P8). The token itself is never stored. */
export type ApiTokenDoc = WithId<ApiToken>;
/** `boards/{id}/webhooks/{id}`: an outgoing webhook (P8). Board owners read it; no secret. */
export type WebhookDoc = WithId<Webhook>;
/** `boards/{id}/incomingHooks/{id}`: an incoming webhook (P8). No URL or secret. */
export type IncomingHookDoc = WithId<IncomingHook>;
/** `workspaces/{id}/members/{uid}`: the uid is the document id. */
export type MemberDoc = WithId<WorkspaceMember>;
export type InviteDoc = WithId<WorkspaceInvite>;

/** `workspaces/{id}/teams/{id}`: a group of workspace members People cells can hold. */
export type TeamDoc = WithId<Team>;
