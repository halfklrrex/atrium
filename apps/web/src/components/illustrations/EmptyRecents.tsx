import { Svg, type IllustrationProps } from './Svg';

/** Two or three overlapping board cards with a small clock badge. */
export function EmptyRecents(props: IllustrationProps) {
  return (
    <Svg box={[250, 120]} {...props}>
      <ellipse cx="125" cy="64" rx="108" ry="48" fill="var(--illus-glow)" />
      <g transform="rotate(-9 90 64)">
        <rect x="46" y="31" width="88" height="66" rx="10" fill="var(--illus-shadow)" />
        <rect
          x="46"
          y="26"
          width="88"
          height="66"
          rx="10"
          fill="var(--illus-surface)"
          stroke="var(--illus-line)"
        />
        <path d="M46 36a10 10 0 0 1 10-10h68a10 10 0 0 1 10 10v14H46Z" fill="var(--illus-pink)" />
        <rect x="58" y="62" width="40" height="5" rx="2.5" fill="var(--illus-line)" />
        <rect x="58" y="73" width="26" height="5" rx="2.5" fill="var(--illus-line)" />
      </g>
      <g transform="rotate(8 160 62)">
        <rect x="116" y="29" width="88" height="66" rx="10" fill="var(--illus-shadow)" />
        <rect
          x="116"
          y="24"
          width="88"
          height="66"
          rx="10"
          fill="var(--illus-surface)"
          stroke="var(--illus-line)"
        />
        <path d="M116 34a10 10 0 0 1 10-10h68a10 10 0 0 1 10 10v14h-88Z" fill="var(--illus-teal)" />
        <rect x="128" y="60" width="40" height="5" rx="2.5" fill="var(--illus-line)" />
        <rect x="128" y="71" width="26" height="5" rx="2.5" fill="var(--illus-line)" />
      </g>
      <rect x="81" y="38" width="88" height="66" rx="10" fill="var(--illus-shadow)" />
      <rect
        x="81"
        y="34"
        width="88"
        height="66"
        rx="10"
        fill="var(--illus-surface)"
        stroke="var(--illus-line)"
      />
      <path d="M81 44a10 10 0 0 1 10-10h68a10 10 0 0 1 10 10v14H81Z" fill="var(--illus-indigo)" />
      <rect x="93" y="70" width="44" height="5" rx="2.5" fill="var(--illus-line)" />
      <rect x="93" y="81" width="28" height="5" rx="2.5" fill="var(--illus-line)" />
      <circle cx="158" cy="86" r="14" fill="var(--illus-orange)" />
      <path
        d="M158 78v8l5 3.5"
        fill="none"
        stroke="var(--illus-on-accent)"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="40" cy="30" r="3.5" fill="var(--illus-orange)" />
      <circle cx="218" cy="34" r="3" fill="var(--illus-pink)" />
    </Svg>
  );
}
