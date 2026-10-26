import styles from './boards.module.css';

/** Stylised board illustration for Home cards: a mini table with coloured status cells. Original art. */
export function BoardThumb() {
  return (
    <svg
      className={styles.thumb}
      viewBox="0 0 160 100"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="20" y="14" width="120" height="76" rx="4" className={styles.thumbSheet} />
      <rect x="28" y="22" width="30" height="4" rx="2" className={styles.thumbTitle} />
      {[0, 1, 2, 3].map((row) => (
        <g key={row} transform={`translate(0 ${34 + row * 13})`}>
          <rect x="28" y="0" width="3" height="9" rx="1" className={styles.thumbBar} />
          <rect x="36" y="2" width="34" height="5" rx="2" className={styles.thumbLine} />
          <rect x="76" y="2" width="22" height="5" rx="2" className={styles.thumbLine} />
          <rect
            x="104"
            y="0"
            width="28"
            height="9"
            className={[styles.cellGreen, styles.cellOrange, styles.cellGreen, styles.cellRed][row]}
          />
        </g>
      ))}
    </svg>
  );
}
