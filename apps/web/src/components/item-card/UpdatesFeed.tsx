import { Button, Icon, IconButton, Loader, Tooltip } from '@vibe/core';
import { Comment, Delete, ThumbsUp, Update as UpdateIcon } from '@vibe/icons';
import classNames from 'classnames';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import { createUpdate, deleteUpdate, toggleLikeUpdate, useItemUpdates } from '../../data/updates';
import { formatRelativeShort } from '../../lib/format';
import { authorLabel, isAutomationActor } from '../../lib/automation-actor';
import { UserAvatar } from '../UserAvatar';
import { MentionedText } from './MentionedText';
import { LazyUpdateComposer } from './LazyUpdateComposer';
import { RichText } from './RichText';
import type { UpdateBody } from './update-doc';
import { UpdateReplies } from './UpdateReplies';
import styles from './UpdatesFeed.module.css';

interface UpdatesFeedProps {
  boardId: string;
  itemId: string;
  /** Scroll this update into view and mark it (opened from a notification). */
  focusUpdateId?: string | null;
  /** With `focusUpdateId`: the reply to open, so its thread is expanded. */
  focusReplyId?: string | null;
}

export function UpdatesFeed({ boardId, itemId, focusUpdateId, focusReplyId }: UpdatesFeedProps) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const { data: updates, loading } = useItemUpdates(boardId, itemId);

  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});

  // A notification deep link: bring the update up (a reply's thread is opened further down).
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusUpdateId || focusedRef.current === focusUpdateId) return;
    if (!updates.some((u) => u.id === focusUpdateId)) return;
    focusedRef.current = focusUpdateId;
    document
      .getElementById(`update-${focusUpdateId}`)
      ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [focusUpdateId, updates]);

  const toggleReplies = (updateId: string) => {
    setExpandedReplies((prev) => ({
      ...prev,
      [updateId]: !prev[updateId],
    }));
  };

  const handlePostUpdate = async (body: UpdateBody) => {
    if (!uid) return;
    await createUpdate({
      boardId,
      itemId,
      authorId: uid,
      authorName: user?.displayName ?? user?.email ?? undefined,
      authorPhotoUrl: user?.photoURL ?? null,
      content: body.content,
      contentDoc: body.contentDoc,
      mentions: body.mentions,
    });
  };

  return (
    <div className={styles.feedContainer} aria-label="Updates feed">
      {/* Composer */}
      {uid && (
        <LazyUpdateComposer
          boardId={boardId}
          variant="update"
          placeholder="Write an update and mention others with @"
          submitLabel="Update"
          onSubmit={handlePostUpdate}
        />
      )}

      {/* Feed list */}
      {loading ? (
        <div className={styles.loadingWrap}>
          <Loader size="medium" />
        </div>
      ) : updates.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIconWrap}>
            <Icon icon={UpdateIcon} size={28} />
          </div>
          <h3 className={styles.emptyTitle}>No updates yet</h3>
          <p className={styles.emptyDescription}>
            Share updates, ask questions, or post notes for this item to keep everyone aligned.
          </p>
        </div>
      ) : (
        <div className={styles.updatesList}>
          {updates.map((update) => {
            const isLiked = uid ? update.likes.includes(uid) : false;
            const canDelete = uid && update.authorId === uid && !isAutomationActor(update.authorId);
            const isFocused = update.id === focusUpdateId;
            const showReplies = expandedReplies[update.id] ?? (isFocused && !!focusReplyId);

            return (
              <article
                key={update.id}
                id={`update-${update.id}`}
                className={classNames(styles.updateCard, isFocused && styles.updateTargeted)}
                aria-label="Item update"
              >
                <header className={styles.updateHeader}>
                  <div className={styles.authorMeta}>
                    <div className={styles.avatar}>
                      <UserAvatar
                        uid={update.authorId}
                        name={update.authorName}
                        photoURL={update.authorPhotoUrl}
                        size="medium"
                      />
                    </div>
                    <span className={styles.authorName}>
                      {authorLabel(update.authorId, update.authorName, uid)}
                    </span>
                    <span className={styles.timestamp}>
                      {formatRelativeShort(update.createdAt)}
                    </span>
                  </div>

                  {canDelete && (
                    <div className={styles.headerActions}>
                      <Tooltip content="Delete update">
                        <IconButton
                          icon={Delete}
                          size="small"
                          kind="tertiary"
                          aria-label="Delete update"
                          onClick={() =>
                            void deleteUpdate({
                              boardId,
                              itemId,
                              updateId: update.id,
                            })
                          }
                        />
                      </Tooltip>
                    </div>
                  )}
                </header>

                <div className={styles.updateContent}>
                  {update.contentDoc ? (
                    <RichText doc={update.contentDoc} />
                  ) : (
                    <MentionedText text={update.content} mentions={update.mentions} />
                  )}
                </div>

                {update.likes.length > 0 && (
                  <div className={styles.reactionRow}>
                    <span className={styles.reactionChip}>
                      <Icon icon={ThumbsUp} size={14} />
                      {update.likes.length}
                    </span>
                  </div>
                )}

                <footer className={styles.updateFooter}>
                  <IconButton
                    icon={ThumbsUp}
                    size="small"
                    kind="tertiary"
                    active={isLiked}
                    aria-label={`Like update (${update.likes.length})`}
                    onClick={() =>
                      uid &&
                      void toggleLikeUpdate({
                        boardId,
                        itemId,
                        updateId: update.id,
                        uid,
                        currentLikes: update.likes,
                      })
                    }
                  />

                  <Button
                    kind="tertiary"
                    size="small"
                    leftIcon={Comment}
                    active={showReplies}
                    aria-label={`Replies (${update.repliesCount})`}
                    onClick={() => toggleReplies(update.id)}
                  >
                    {update.repliesCount > 0 ? `${update.repliesCount} replies` : 'Reply'}
                  </Button>
                </footer>

                {(showReplies || update.repliesCount > 0) && (
                  <UpdateReplies
                    boardId={boardId}
                    itemId={itemId}
                    updateId={update.id}
                    autoFocusComposer={showReplies && !isFocused}
                    focusReplyId={isFocused ? focusReplyId : null}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
