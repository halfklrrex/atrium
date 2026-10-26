import type { VoteSettings, VoteValue } from '@atrium/shared';
import { ThumbsUp } from '@vibe/icons';
import classNames from 'classnames';
import type { MouseEvent } from 'react';
import { useAuth } from '../auth/auth-context';
import { auth } from '../lib/firebase';
import styles from './cells.module.css';
import { defineColumnUi, type CellProps } from './types';

function VoteCell({ value, column, ctx, onChange }: CellProps<VoteValue, VoteSettings>) {
  const { user } = useAuth();
  const uid = user?.uid;
  const voters = value?.votersIds ?? [];
  const hasVoted = Boolean(uid && voters.includes(uid));

  const handleToggle = (e: MouseEvent) => {
    e.stopPropagation();
    if (!ctx.canEdit || !uid) return;
    const nextVoters = hasVoted ? voters.filter((id) => id !== uid) : [...voters, uid];
    onChange({ votersIds: nextVoters });
  };

  return (
    <div className={styles.root}>
      <button
        type="button"
        aria-label={`${column.title}: ${voters.length} votes`}
        aria-pressed={hasVoted}
        disabled={!ctx.canEdit}
        className={classNames(styles.voteBtn, hasVoted && styles.voteBtnActive)}
        onClick={handleToggle}
      >
        <ThumbsUp className={styles.voteIcon} aria-hidden="true" />
        {voters.length > 0 ? <span>{voters.length}</span> : null}
      </button>
    </div>
  );
}

export const voteUi = defineColumnUi<VoteValue, VoteSettings>({
  type: 'vote',
  icon: ThumbsUp,
  tone: 'blue',
  editor: 'toggle',
  Cell: VoteCell,
  toggle: (current) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return current;
    const voters = current?.votersIds ?? [];
    const hasVoted = voters.includes(uid);
    const next = hasVoted ? voters.filter((id) => id !== uid) : [...voters, uid];
    return { votersIds: next };
  },
});
