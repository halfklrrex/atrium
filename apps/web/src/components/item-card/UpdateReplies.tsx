import { Icon, IconButton, Loader } from '@vibe/core';
import { Delete, ThumbsUp } from '@vibe/icons';
import classNames from 'classnames';
import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import { createReply, deleteReply, toggleLikeReply, useUpdateReplies } from '../../data/updates';
import { formatRelativeShort } from '../../lib/format';
import { authorLabel, isAutomationActor } from '../../lib/automation-actor';
import { UserAvatar } from '../UserAvatar';
import { MentionedText } from './MentionedText';
import { LazyUpdateComposer } from './LazyUpdateComposer';
import { UpdateAttachments } from './UpdateAttachments';
import { RichText } from './RichText';
import type { UpdateBody } from './update-doc';
import styles from './UpdateReplies.module.css';

interface UpdateRepliesProps {
  boardId: string;
  itemId: string;
  updateId: string;
  /** Focus the reply field on mount (set when opened with the Reply button). */
  autoFocusComposer?: boolean;
  /** Scroll this reply into view and mark it (opened from a notification). */
  focusReplyId?: string | null;
  /** The signed-in user owns the board and may remove anyone's attachments. */
  canManage?: boolean;
}

export function UpdateReplies({
  boardId,
  itemId,
  updateId,
  autoFocusComposer = false,
  focusReplyId = null,
  canManage = false,
}: UpdateRepliesProps) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const { data: replies, loading } = useUpdateReplies(boardId, itemId, updateId);
  // The editor is only created once the reply box is opened, so a long thread has no stray editors.
  const [composerOpen, setComposerOpen] = useState(autoFocusComposer);

  useEffect(() => {
    if (!focusReplyId || !replies.some((r) => r.id === focusReplyId)) return;
    document
      .getElementById(`reply-${focusReplyId}`)
      ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [focusReplyId, replies]);

  const handleSubmit = async (body: UpdateBody): Promise<string | void> => {
    if (!uid) return;
    return createReply({
      boardId,
      itemId,
      updateId,
      authorId: uid,
      authorName: user?.displayName ?? user?.email ?? undefined,
      authorPhotoUrl: user?.photoURL ?? null,
      content: body.content,
      contentDoc: body.contentDoc,
      mentions: body.mentions,
    });
  };

  return (
    <div className={styles.repliesThread} aria-label="Replies thread">
      {loading ? (
        <Loader size="small" />
      ) : (
        <div className={styles.replyList}>
          {replies.map((reply) => {
            const isLiked = uid ? reply.likes.includes(uid) : false;
            const canDelete = uid && reply.authorId === uid && !isAutomationActor(reply.authorId);

            return (
              <div
                key={reply.id}
                id={`reply-${reply.id}`}
                className={classNames(
                  styles.replyRow,
                  reply.id === focusReplyId && styles.targeted,
                )}
              >
                <div className={styles.avatar}>
                  <UserAvatar
                    uid={reply.authorId}
                    name={reply.authorName}
                    photoURL={reply.authorPhotoUrl}
                    size="medium"
                  />
                </div>
                <div className={styles.replyMain}>
                  <div className={styles.replyBubble}>
                    <div className={styles.replyHeader}>
                      <span className={styles.authorName}>
                        {authorLabel(reply.authorId, reply.authorName, uid)}
                      </span>
                      <span className={styles.timestamp}>
                        {formatRelativeShort(reply.createdAt)}
                      </span>
                    </div>
                    <div className={styles.replyContent}>
                      {reply.contentDoc ? (
                        <RichText doc={reply.contentDoc} />
                      ) : (
                        <MentionedText text={reply.content} mentions={reply.mentions} />
                      )}
                    </div>
                    <UpdateAttachments
                      compact
                      target={{ boardId, itemId, updateId, replyId: reply.id }}
                      attachments={reply.attachments}
                      canRemove={(file) =>
                        !!uid && (canManage || file.uploadedBy === uid || reply.authorId === uid)
                      }
                    />
                  </div>

                  <div className={styles.replyFooter}>
                    <button
                      type="button"
                      className={classNames(styles.likeButton, isLiked && styles.liked)}
                      onClick={() =>
                        uid &&
                        void toggleLikeReply({
                          boardId,
                          itemId,
                          updateId,
                          replyId: reply.id,
                          uid,
                          currentLikes: reply.likes,
                        })
                      }
                      aria-label={`Like reply (${reply.likes.length})`}
                    >
                      <Icon icon={ThumbsUp} size={14} />
                      <span>{reply.likes.length > 0 ? reply.likes.length : 'Like'}</span>
                    </button>
                    {canDelete && (
                      <IconButton
                        icon={Delete}
                        size="xs"
                        kind="tertiary"
                        aria-label="Delete reply"
                        onClick={() =>
                          void deleteReply({
                            boardId,
                            itemId,
                            updateId,
                            replyId: reply.id,
                          })
                        }
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {uid && (
        <div className={styles.replyComposer}>
          <div className={styles.avatar}>
            <UserAvatar uid={uid} size="medium" />
          </div>
          <div className={styles.composerInputWrap}>
            {composerOpen ? (
              <LazyUpdateComposer
                boardId={boardId}
                variant="reply"
                placeholder="Write a reply and mention others with @"
                autoFocus
                submitLabel="Reply"
                onSubmit={handleSubmit}
                attachTarget={(replyId) => ({ boardId, itemId, updateId, replyId })}
              />
            ) : (
              <button
                type="button"
                className={styles.replyPlaceholder}
                onClick={() => setComposerOpen(true)}
              >
                Write a reply and mention others with @
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
