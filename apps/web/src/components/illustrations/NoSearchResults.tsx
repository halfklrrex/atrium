import { Svg, type IllustrationProps } from './Svg';

/** A magnifier over faded rows. */
export function NoSearchResults(props: IllustrationProps) {
  return (
    <Svg box={[250, 120]} {...props}>
      <ellipse cx="125" cy="62" rx="108" ry="50" fill="var(--illus-glow)" />
      {[18, 46, 74].map((y, i) => (
        <g key={y}>
          <rect x="52" y={y + 3} width="146" height="22" rx="8" fill="var(--illus-shadow)" />
          <rect
            x="52"
            y={y}
            width="146"
            height="22"
            rx="8"
            fill="var(--illus-surface)"
            stroke="var(--illus-line)"
          />
          <circle cx="66" cy={y + 11} r="5" fill="var(--illus-line)" />
          <rect x="78" y={y + 8} width={70 - i * 10} height="6" rx="3" fill="var(--illus-line)" />
          <rect x="160" y={y + 6} width="26" height="10" rx="5" fill="var(--illus-line)" />
        </g>
      ))}
      <circle
        cx="138"
        cy="58"
        r="26"
        fill="var(--illus-surface)"
        fillOpacity="0.55"
        stroke="var(--illus-indigo)"
        strokeWidth="7"
      />
      <path d="m158 78 22 22" stroke="var(--illus-indigo)" strokeWidth="9" strokeLinecap="round" />
      <path d="M127 58h22" stroke="var(--illus-pink)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="38" cy="38" r="3.5" fill="var(--illus-orange)" />
      <rect x="212" y="30" width="9" height="9" rx="3" fill="var(--illus-teal)" opacity="0.8" />
    </Svg>
  );
}
