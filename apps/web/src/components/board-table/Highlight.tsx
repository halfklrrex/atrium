import { splitMatches } from './search';
import styles from './Highlight.module.css';

/** Text with every occurrence of the search term highlighted in yellow. */
export function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  return (
    <>
      {splitMatches(text, term).map((part, i) =>
        part.match ? (
          <mark key={i} className={styles.mark}>
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}
