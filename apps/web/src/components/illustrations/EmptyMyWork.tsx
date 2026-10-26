import { Svg, type IllustrationProps } from './Svg';

const ROWS = [
  { x: 40, y: 20, dot: 'pink', pill: 'orange', bar: 46 },
  { x: 58, y: 49, dot: 'indigo', pill: 'teal', bar: 38 },
  { x: 46, y: 78, dot: 'teal', pill: 'pink', bar: 52 },
] as const;

/** Stacked task rows with coloured status pills and a gentle check badge. */
export function EmptyMyWork(props: IllustrationProps) {
  return (
    <Svg box={[250, 120]} {...props}>
      <ellipse cx="125" cy="62" rx="108" ry="50" fill="var(--illus-glow)" />
      {ROWS.map(({ x, y, dot, pill, bar }) => (
        <g key={y}>
          <rect x={x} y={y + 3} width="150" height="24" rx="8" fill="var(--illus-shadow)" />
          <rect
            x={x}
            y={y}
            width="150"
            height="24"
            rx="8"
            fill="var(--illus-surface)"
            stroke="var(--illus-line)"
          />
          <circle cx={x + 14} cy={y + 12} r="6" fill={`var(--illus-${dot})`} />
          <rect x={x + 28} y={y + 9} width={bar} height="6" rx="3" fill="var(--illus-line)" />
          <rect x={x + 100} y={y + 6} width="40" height="12" rx="6" fill={`var(--illus-${pill})`} />
        </g>
      ))}
      <circle cx="206" cy="42" r="19" fill="var(--illus-glow)" />
      <circle cx="206" cy="42" r="15" fill="var(--illus-teal)" />
      <path
        d="m199 42.5 5 5 9-10"
        fill="none"
        stroke="var(--illus-on-accent)"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="30" cy="40" r="3" fill="var(--illus-orange)" />
      <circle cx="226" cy="86" r="4" fill="var(--illus-indigo)" opacity="0.7" />
      <rect x="22" y="86" width="9" height="9" rx="3" fill="var(--illus-pink)" opacity="0.8" />
    </Svg>
  );
}
