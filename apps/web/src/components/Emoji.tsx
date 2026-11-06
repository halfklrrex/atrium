import classNames from 'classnames';
import { useState } from 'react';
import { needsFlagImage, twemojiUrl } from '../lib/flag-emoji';
import styles from './Emoji.module.css';

/**
 * An emoji as text, except a flag on a platform without flag glyphs (Windows): that one is a
 * Twemoji picture with the emoji as its alt text, and plain text again if the picture fails to load.
 */
export function Emoji({ emoji, className }: { emoji: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !needsFlagImage(emoji)) return <>{emoji}</>;
  return (
    <img
      className={classNames(styles.image, className)}
      src={twemojiUrl(emoji)}
      alt={emoji}
      draggable={false}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
