import { Svg, type IllustrationProps } from './Svg';

/** The Atrium courtyard grown into a scene: four board tiles around an open, inviting centre. */
export function EmptyWorkspace(props: IllustrationProps) {
  return (
    <Svg box={[250, 120]} {...props}>
      <ellipse cx="125" cy="62" rx="112" ry="52" fill="var(--illus-glow)" />
      <g transform="translate(75 10)">
        <g fill="var(--illus-shadow)">
          <rect x="0" y="3" width="62" height="34" rx="9" />
          <rect x="68" y="3" width="32" height="62" rx="9" />
          <rect x="38" y="71" width="62" height="34" rx="9" />
          <rect x="0" y="43" width="32" height="62" rx="9" />
        </g>
        <rect x="0" y="0" width="62" height="34" rx="9" fill="var(--illus-indigo)" />
        <rect x="68" y="0" width="32" height="62" rx="9" fill="var(--illus-teal)" />
        <rect x="38" y="68" width="62" height="34" rx="9" fill="var(--illus-orange)" />
        <rect x="0" y="40" width="32" height="62" rx="9" fill="var(--illus-pink)" />
        {/* board motifs on the tiles */}
        <g fill="var(--illus-on-accent)" opacity="0.85">
          <rect x="9" y="9" width="30" height="5" rx="2.5" />
          <rect x="9" y="20" width="18" height="5" rx="2.5" />
          <rect x="44" y="9" width="9" height="16" rx="4.5" opacity="0.7" />
          <rect x="77" y="10" width="14" height="5" rx="2.5" />
          <rect x="77" y="21" width="14" height="5" rx="2.5" />
          <circle cx="84" cy="44" r="5" />
          <rect x="47" y="77" width="30" height="5" rx="2.5" />
          <rect x="47" y="88" width="42" height="5" rx="2.5" opacity="0.7" />
          <circle cx="16" cy="52" r="5" />
          <rect x="9" y="66" width="14" height="5" rx="2.5" />
          <rect x="9" y="77" width="14" height="5" rx="2.5" />
        </g>
        {/* the open courtyard */}
        <rect
          x="37"
          y="37"
          width="26"
          height="26"
          rx="8"
          fill="var(--illus-surface)"
          stroke="var(--illus-line)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
        <path
          d="M50 44.5v11M44.5 50h11"
          stroke="var(--illus-indigo)"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </g>
      <circle cx="42" cy="34" r="4" fill="var(--illus-orange)" />
      <rect x="196" y="22" width="10" height="10" rx="3" fill="var(--illus-pink)" opacity="0.8" />
      <circle cx="214" cy="92" r="5" fill="var(--illus-indigo)" opacity="0.6" />
      <rect x="30" y="88" width="12" height="12" rx="4" fill="var(--illus-teal)" opacity="0.7" />
    </Svg>
  );
}
