import { useMemo } from 'react';
import { useUserLookup } from '../../data/members-store';
import { splitMentions } from './mentions';
import styles from './MentionTextarea.module.css';

/** Post text with "@Name" of each mentioned member in the primary colour. */
export function MentionedText({
  text,
  mentions,
}: {
  text: string;
  mentions: readonly string[] | undefined;
}) {
  const lookup = useUserLookup();
  const parts = useMemo(() => {
    const names = (mentions ?? []).flatMap((uid) => lookup(uid)?.name ?? []);
    return splitMentions(text, names);
  }, [text, mentions, lookup]);

  if (parts.length === 1 && !parts[0]?.mention) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) =>
        part.mention ? (
          <span key={index} className={styles.mention}>
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}
