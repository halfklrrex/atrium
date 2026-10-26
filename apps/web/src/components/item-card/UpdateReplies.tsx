import { Button, Icon, IconButton, Loader } from '@vibe/core';
import { Delete, ThumbsUp } from '@vibe/icons';
import classNames from 'classnames';
import { useState, type KeyboardEvent } from 'react';
import { useAuth } from '../../auth/auth-context';
import { createReply, deleteReply, toggleLikeReply, useUpdateReplies } from '../../data/updates';
import { formatRelativeShort } from '../../lib/format';
import { UserAvatar } from '../UserAvatar';
import styles from './UpdateReplies.module.css';

interface UpdateRepliesProps {
  boardId: string;
  itemId: string;
  updateId: string;
  /** Focus the reply field on mount (set when opened with the Reply button). */
  autoFocusComposer?: boolean;
}

export function UpdateReplies({
  boardId,
  itemId,
  updateId,
  autoFocusComposer = false,
}: UpdateRepliesProps) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const { data: replies, loading } = useUpdateReplies(boardId, itemId, updateId);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed || !uid || submitting) return;
    setSubmitting(true);
    try {
      await createReply({
        boardId,
        itemId,
        updateId,
        authorId: uid,
        authorName: user?.displayName ?? user?.email ?? undefined,
        authorPhotoUrl: user?.photoURL ?? null,
        content: trimmed,
      });
      setContent('');
    } catch (error) {
      console.error('Failed to post reply', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div className={styles.repliesThread} aria-label="Replies thread">
      {loading ? (
        <Loader size="small" />
      ) : (
        <div className={styles.replyList}>
          {replies.map((reply) => {
            const isLiked = uid ? reply.likes.includes(uid) : false;
            const canDelete = uid && reply.authorId === uid;

            return (
              <div key={reply.id} className={styles.replyRow}>
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
                        {reply.authorName ?? (reply.authorId === uid ? 'You' : 'Member')}
                      </span>
                      <span className={styles.timestamp}>
                        {formatRelativeShort(reply.createdAt)}
                      </span>
                    </div>
                    <div className={styles.replyContent}>{reply.content}</div>
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
            <textarea
              className={styles.replyInput}
              rows={1}
              placeholder="Write a reply and mention others with @"
              value={content}
              autoFocus={autoFocusComposer}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {content.trim() && (
              <div>
                <Button
                  size="medium"
                  kind="primary"
                  disabled={submitting}
                  loading={submitting}
                  onClick={() => void handleSubmit()}
                >
                  Reply
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
