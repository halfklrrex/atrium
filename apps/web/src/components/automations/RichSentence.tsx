import type { DescribePart } from './describe-automation';
import styles from './RichSentence.module.css';

/** A described sentence with bold names and coloured label chips (builder "Reads as", Manage). */
export function RichSentence({ parts }: { parts: readonly DescribePart[] }) {
  return (
    <>
      {parts.map((part, i) =>
        part.color ? (
          <span
            key={i}
            className={styles.chip}
            data-chip=""
            style={{ backgroundColor: part.color }}
          >
            {part.text}
          </span>
        ) : part.strong ? (
          <strong key={i}>{part.text}</strong>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}
