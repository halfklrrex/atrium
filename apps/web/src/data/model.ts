import type {
  Board,
  BoardView,
  Favorite,
  Folder,
  Item,
  ItemUpdate,
  Recent,
  UpdateReply,
  User,
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
} from '@atrium/shared';

/** A document as the UI sees it: data plus its Firestore id. */
export type WithId<T> = T & { id: string };

export type WorkspaceDoc = WithId<Workspace>;
export type FolderDoc = WithId<Folder>;
export type BoardDoc = WithId<Board>;
/** A saved view; `synthetic` marks the built-in `main` view that has not been saved yet. */
export type BoardViewDoc = WithId<BoardView> & { synthetic?: boolean };
export type ItemDoc = WithId<Item>;
export type ItemUpdateDoc = WithId<ItemUpdate>;
export type UpdateReplyDoc = WithId<UpdateReply>;
export type UserDoc = WithId<User>;
export type FavoriteDoc = WithId<Favorite>;
export type RecentDoc = WithId<Recent>;
/** `workspaces/{id}/members/{uid}`: the uid is the document id. */
export type MemberDoc = WithId<WorkspaceMember>;
export type InviteDoc = WithId<WorkspaceInvite>;
