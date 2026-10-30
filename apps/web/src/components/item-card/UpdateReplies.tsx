import { Button, Icon, IconButton, Loader } from '@vibe/core';
import { Delete, ThumbsUp } from '@vibe/icons';
import classNames from 'classnames';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { useAuth } from '../../auth/auth-context';
import { createReply, deleteReply, toggleLikeReply, useUpdateReplies } from '../../data/updates';
import { formatRelativeShort } from '../../lib/format';
import { UserAvatar } from '../UserAvatar';
import { MentionedText } from './MentionedText';
import { MentionTextarea } from './MentionTextarea';
import { mentionIdsInText, type PickedMention } from './mentions';
import styles from './UpdateReplies.module.css';

interface UpdateRepliesProps {
  boardId: string;
  itemId: string;
  updateId: string;
  /** Focus the reply field on mount (set when opened with the Reply button). */
  autoFocusComposer?: boolean;
  /** Scroll this reply into view and mark it (opened from a notification). */
  focusReplyId?: string | null;
}

export function UpdateReplies({
  boardId,
  itemId,
  updateId,
  autoFocusComposer = false,
  focusReplyId = null,
}: UpdateRepliesProps) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const { data: replies, loading } = useUpdateReplies(boardId, itemId, updateId);
  const [content, setContent] = useState('');
  const [picked, setPicked] = useState<PickedMention[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!focusReplyId || !replies.some((r) => r.id === focusReplyId)) return;
    document
      .getElementById(`reply-${focusReplyId}`)
      ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [focusReplyId, replies]);

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
        mentions: mentionIdsInText(trimmed, picked),
      });
      setContent('');
      setPicked([]);
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
                        {reply.authorName ?? (reply.authorId === uid ? 'You' : 'Member')}
                      </span>
                      <span className={styles.timestamp}>
                        {formatRelativeShort(reply.createdAt)}
                      </span>
                    </div>
                    <div className={styles.replyContent}>
                      <MentionedText text={reply.content} mentions={reply.mentions} />
                    </div>
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
            <MentionTextarea
              boardId={boardId}
              className={styles.replyInput}
              rows={1}
              placeholder="Write a reply and mention others with @"
              value={content}
              autoFocus={autoFocusComposer}
              onValueChange={setContent}
              onMention={(m) => setPicked((prev) => [...prev, m])}
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
