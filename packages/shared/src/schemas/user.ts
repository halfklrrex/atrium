import { z } from 'zod';
import { themePreferenceSchema } from '../roles';
import { idSchema, positionSchema, timestampSchema, type WriteDoc } from './common';

/** `users/{uid}` (architecture §5.1). */
export const userSchema = z.object({
  displayName: z.string().max(200),
  email: z.string().max(320),
  photoURL: z.string().max(2048).nullable(),
  timezone: z.string().max(64),
  locale: z.string().max(32),
  lastWorkspaceId: idSchema.nullable(),
  theme: themePreferenceSchema,
  createdAt: timestampSchema,
});
export type User = z.infer<typeof userSchema>;
export type UserWrite = WriteDoc<User>;

/** Fields a signed-in user may change on their own profile (mirrors firestore.rules). */
export const userProfileUpdateSchema = z
  .object({
    timezone: z.string().max(64),
    locale: z.string().max(32),
    lastWorkspaceId: idSchema,
    theme: themePreferenceSchema,
  })
  .partial()
  .strict();
export type UserProfileUpdate = z.infer<typeof userProfileUpdateSchema>;

/** `users/{uid}/favorites/{boardId}` - the signed-in user's starred boards (self-only). */
export const favoriteSchema = z.object({
  boardId: idSchema,
  workspaceId: idSchema,
  addedAt: timestampSchema,
  /** Fractional index ordering the favourites list. */
  position: positionSchema,
});
export type Favorite = z.infer<typeof favoriteSchema>;
export type FavoriteWrite = WriteDoc<Favorite>;

/** `users/{uid}/recents/{boardId}` - last visit per board (self-only). The client shows the newest 12. */
export const recentSchema = z.object({
  boardId: idSchema,
  workspaceId: idSchema,
  visitedAt: timestampSchema,
});
export type Recent = z.infer<typeof recentSchema>;
export type RecentWrite = WriteDoc<Recent>;

/** How many recently visited boards the UI keeps and shows. */
export const MAX_RECENTS = 12;
