import { Button, Icon, IconButton, Loader, Tooltip } from '@vibe/core';
import {
  Bold,
  Bullets,
  Comment,
  Delete,
  Italic,
  ThumbsUp,
  Update as UpdateIcon,
} from '@vibe/icons';
import classNames from 'classnames';
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { useAuth } from '../../auth/auth-context';
import { createUpdate, deleteUpdate, toggleLikeUpdate, useItemUpdates } from '../../data/updates';
import { formatRelativeShort } from '../../lib/format';
import { UserAvatar } from '../UserAvatar';
import { MentionedText } from './MentionedText';
import { MentionTextarea } from './MentionTextarea';
import { mentionIdsInText, type PickedMention } from './mentions';
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

  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState<PickedMention[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const expanded = isFocused || draft.length > 0;

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

  const handleComposerBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setIsFocused(false);
  };

  const toggleReplies = (updateId: string) => {
    setExpandedReplies((prev) => ({
      ...prev,
      [updateId]: !prev[updateId],
    }));
  };

  const handlePostUpdate = async () => {
    const trimmed = draft.trim();
    if (!trimmed || !uid || submitting) return;
    setSubmitting(true);
    try {
      await createUpdate({
        boardId,
        itemId,
        authorId: uid,
        authorName: user?.displayName ?? user?.email ?? undefined,
        authorPhotoUrl: user?.photoURL ?? null,
        content: trimmed,
        mentions: mentionIdsInText(trimmed, picked),
      });
      setDraft('');
      setPicked([]);
    } catch (error) {
      console.error('Failed to post update', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handlePostUpdate();
    }
  };

  const insertFormatting = (prefix: string, suffix: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = draft;
    const selected = text.slice(start, end);
    const replacement = `${prefix}${selected || 'text'}${suffix}`;

    const newDraft = text.slice(0, start) + replacement + text.slice(end);
    setDraft(newDraft);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + prefix.length,
        start + prefix.length + (selected.length || 4),
      );
    }, 0);
  };

  return (
    <div className={styles.feedContainer} aria-label="Updates feed">
      {/* Composer */}
      {uid && (
        <div
          className={classNames(
            styles.composerBox,
            expanded && styles.composerBoxExpanded,
            isFocused && styles.composerBoxFocused,
          )}
          onFocus={() => setIsFocused(true)}
          onBlur={handleComposerBlur}
        >
          {expanded && (
            <div className={styles.composerToolbar} role="toolbar" aria-label="Text formatting">
              <Tooltip content="Bold">
                <button
                  type="button"
                  className={styles.toolButton}
                  onClick={() => insertFormatting('**', '**')}
                  aria-label="Format bold"
                >
                  <Icon icon={Bold} size={16} />
                </button>
              </Tooltip>
              <Tooltip content="Italic">
                <button
                  type="button"
                  className={styles.toolButton}
                  onClick={() => insertFormatting('*', '*')}
                  aria-label="Format italic"
                >
                  <Icon icon={Italic} size={16} />
                </button>
              </Tooltip>
              <Tooltip content="Bulleted list">
                <button
                  type="button"
                  className={styles.toolButton}
                  onClick={() => insertFormatting('\n- ')}
                  aria-label="Format list"
                >
                  <Icon icon={Bullets} size={16} />
                </button>
              </Tooltip>
            </div>
          )}

          <MentionTextarea
            boardId={boardId}
            inputRef={textareaRef}
            className={classNames(
              styles.composerTextarea,
              expanded && styles.composerTextareaExpanded,
            )}
            placeholder="Write an update and mention others with @"
            value={draft}
            onValueChange={setDraft}
            onMention={(m) => setPicked((prev) => [...prev, m])}
            onKeyDown={handleKeyDown}
            rows={expanded ? 3 : 1}
          />

          {expanded && (
            <div className={styles.composerFooter}>
              <span className={styles.composerHints}>Ctrl+Enter to post</span>
              <Button
                kind="primary"
                size="small"
                disabled={!draft.trim() || submitting}
                loading={submitting}
                onClick={() => void handlePostUpdate()}
              >
                Update
              </Button>
            </div>
          )}
        </div>
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
            const canDelete = uid && update.authorId === uid;
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
                      {update.authorName ?? (update.authorId === uid ? 'You' : 'Member')}
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
                  <MentionedText text={update.content} mentions={update.mentions} />
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
