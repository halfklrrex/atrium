# P1c: Item card & updates feed

Author: Antigravity · Implementer: Antigravity · Roadmap: P1 "Item card & updates feed" · Branch: `ag/item-card-updates`

## Summary

The item card is monday's slide-over panel that opens when an item is selected or its updates bubble is clicked. It houses the rich conversation, updates history, replies, activity log, and files related to an item.

Target: `docs/reference/monday/06-item-card.jpg` and `docs/reference/monday-ui-reference.md`.

---

## 1. Data Model (Firestore)

### Subcollections under `boards/{boardId}/items/{itemId}`:

#### 1. `updates/{updateId}`

```ts
interface ItemUpdate {
  id: string;
  itemId: string;
  authorId: string;
  authorName?: string;
  authorPhotoUrl?: string | null;
  content: string; // rich text HTML / markdown / plain text
  likes: string[]; // uids of users who liked
  repliesCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

#### 2. `updates/{updateId}/replies/{replyId}`

```ts
interface UpdateReply {
  id: string;
  updateId: string;
  authorId: string;
  authorName?: string;
  authorPhotoUrl?: string | null;
  content: string;
  likes: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

## 2. Components & UI

1. **Slide-over Drawer (`apps/web/src/components/item-card/ItemCardDrawer.tsx`):**
   - Width: ~580px, sliding from the right edge over the content area with a soft backdrop.
   - Header:
     - Editable item name (Poppins 18px).
     - Close button (✕).
     - Next/previous item navigation chevron buttons.
     - `⋯` Menu: Duplicate, Archive, Delete item.
   - Tabs:
     - **Updates** (active by default, with badge showing update count).
     - **Activity Log** (placeholder or initial log entries).
     - **Files** (placeholder).

2. **Updates Feed (`apps/web/src/components/item-card/UpdatesFeed.tsx`):**
   - **Composer:**
     - "Write an update..." rich text / markdown input.
     - Action toolbar (bold, italic, list, mention).
     - "Update" primary button.
   - **Update Post:**
     - Author Avatar (32px) + Name + Timestamp (relative).
     - Post body.
     - Footer:
       - Like button with thumbs-up icon + like count (toggleable).
       - Reply button with reply count.
   - **Replies Thread:**
     - Collapsible reply list under the post.
     - Inline reply composer.

3. **Data Hooks (`apps/web/src/data/updates.ts`):**
   - `useItemUpdates(boardId, itemId)`: Real-time listener on `updates` ordered by `createdAt desc`.
   - `useUpdateReplies(boardId, itemId, updateId)`: Real-time listener on replies ordered by `createdAt asc`.
   - Mutations: `createUpdate`, `toggleLikeUpdate`, `createReply`, `deleteUpdate`.

---

## 3. Security Rules (`firestore.rules`)

- `updates` and `replies` inherit authorization from the parent board via `canReadBoard(boardId)` and `canEditBoard(boardId)`.
- Updates can be created by any board editor.
- Likes can be toggled by any board editor.
- Updates can be edited/deleted by their author or board owner.

---

## 4. Verification & Testing

- Unit tests for update/reply schemas and mutations.
- Component tests for `ItemCardDrawer` and `UpdatesFeed`.
- Rules tests for update creation, likes, and reply permissions.
