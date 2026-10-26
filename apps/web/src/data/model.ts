import type {
  Board,
  Favorite,
  Folder,
  Item,
  ItemUpdate,
  Recent,
  UpdateReply,
  User,
  Workspace,
} from '@atrium/shared';

/** A document as the UI sees it: data plus its Firestore id. */
export type WithId<T> = T & { id: string };

export type WorkspaceDoc = WithId<Workspace>;
export type FolderDoc = WithId<Folder>;
export type BoardDoc = WithId<Board>;
export type ItemDoc = WithId<Item>;
export type ItemUpdateDoc = WithId<ItemUpdate>;
export type UpdateReplyDoc = WithId<UpdateReply>;
export type UserDoc = WithId<User>;
export type FavoriteDoc = WithId<Favorite>;
export type RecentDoc = WithId<Recent>;
