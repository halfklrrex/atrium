import { Svg, type IllustrationProps } from './Svg';

/** A small star outline for the inline "no favourites yet" hint. */
export function NoFavorites({ width = 28, className }: IllustrationProps) {
  return (
    <Svg box={[32, 32]} width={width} className={className}>
      <path
        d="m16 4.5 3.4 7 7.6 1.1-5.5 5.4 1.3 7.6L16 22l-6.8 3.6 1.3-7.6L5 12.6l7.6-1.1Z"
        fill="var(--illus-glow)"
        stroke="var(--illus-orange)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="26" cy="6" r="2" fill="var(--illus-pink)" />
      <circle cx="5" cy="25" r="1.6" fill="var(--illus-teal)" />
    </Svg>
  );
}
