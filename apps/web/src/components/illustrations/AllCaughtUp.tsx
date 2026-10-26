import { Svg, type IllustrationProps } from './Svg';

/** A burst of confetti shapes around a check badge, for "nothing new" panels. */
export function AllCaughtUp(props: IllustrationProps) {
  return (
    <Svg box={[130, 130]} {...props}>
      <circle cx="65" cy="68" r="46" fill="var(--illus-glow)" />
      <circle cx="65" cy="71" r="30" fill="var(--illus-shadow)" />
      <circle cx="65" cy="68" r="30" fill="var(--illus-teal)" />
      <path
        d="m52 68.5 9.5 9.5L79 58"
        fill="none"
        stroke="var(--illus-on-accent)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* confetti */}
      <g strokeLinecap="round">
        <path d="m24 31 12-8" stroke="var(--illus-indigo)" strokeWidth="6" />
        <path d="m93 24 10 6" stroke="var(--illus-pink)" strokeWidth="6" />
        <path d="m106 58 10-3" stroke="var(--illus-orange)" strokeWidth="6" />
        <path d="m12 74 10 4" stroke="var(--illus-pink)" strokeWidth="6" />
      </g>
      <circle cx="58" cy="12" r="4" fill="var(--illus-orange)" />
      <circle cx="116" cy="94" r="4" fill="var(--illus-indigo)" />
      <circle cx="18" cy="104" r="3.5" fill="var(--illus-teal)" />
      <rect
        x="86"
        y="106"
        width="9"
        height="9"
        rx="3"
        fill="var(--illus-pink)"
        transform="rotate(20 90 110)"
      />
      <rect
        x="38"
        y="108"
        width="8"
        height="8"
        rx="2.5"
        fill="var(--illus-indigo)"
        transform="rotate(-15 42 112)"
      />
      <path
        d="m112 24 2.3 5 5.2.6-3.9 3.6 1.1 5.2-4.7-2.7-4.6 2.7 1-5.2-3.8-3.6 5.2-.6Z"
        fill="var(--illus-orange)"
        stroke="var(--illus-orange)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
