import { Button, TextField, Toggle } from '@vibe/core';
import { useState } from 'react';
import { showToast } from '../toast-store';
import styles from './builder.module.css';

interface Props {
  link: string;
  accepting: boolean;
  /** Why the form can't be switched on right now (empty = it can). */
  problems: readonly string[];
  disabled?: boolean;
  onAcceptingChange: (accepting: boolean) => void;
}

/** The share link, the Accepting responses switch (blocked while the form isn't publishable) and Copy link. */
export function SharePanel({ link, accepting, problems, disabled, onAcceptingChange }: Props) {
  const [blocked, setBlocked] = useState(false);

  const change = (on: boolean) => {
    if (on && problems.length > 0) {
      setBlocked(true);
      return;
    }
    setBlocked(false);
    onAcceptingChange(on);
  };

  const copy = () => {
    navigator.clipboard.writeText(link).then(
      () => showToast('Link copied.'),
      () =>
        showToast('Could not copy the link. Select it and copy it by hand.', { type: 'negative' }),
    );
  };

  return (
    <section className={styles.section} aria-label="Share">
      <h3 className={styles.sectionTitle}>Share</h3>
      <div className={styles.switchRow}>
        <Toggle
          isSelected={accepting}
          disabled={disabled}
          onChange={change}
          aria-label="Accepting responses"
          areLabelsHidden
        />
        <span>Accepting responses</span>
      </div>
      <p className={styles.hint}>
        {accepting
          ? 'Anyone who signs in with a Google account and has the link can respond.'
          : 'The link shows "This form isn\'t available" until you switch this on.'}
      </p>
      {problems.length > 0 ? (
        <div
          className={blocked ? styles.problemsBlocked : styles.problems}
          role={blocked ? 'alert' : undefined}
        >
          <p className={styles.problemsTitle}>Fix these before you accept responses:</p>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className={styles.linkRow}>
        <TextField value={link} readonly inputAriaLabel="Form link" onChange={() => undefined} />
        <Button kind="secondary" size="small" onClick={copy}>
          Copy link
        </Button>
      </div>
    </section>
  );
}
