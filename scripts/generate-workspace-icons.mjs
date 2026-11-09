// Generates apps/web/src/components/workspace-icons/icons.generated.ts (fill paths, eager) and
// icons-regular.generated.ts (regular paths, lazy): a curated set of Phosphor
// icons (regular and fill weights) as SVG path data for workspace and folder icons
// (docs/specs/ICONS-phosphor-icon-picker.md).
//
//   pnpm icons:generate          rewrite the module
//   pnpm icons:generate --check  fail when the committed module is stale (also run by a unit test)
//
// Source: the `@phosphor-icons/core` devDependency (MIT, Phosphor Icons). The package is never
// imported at runtime; only the path data of the icons below is copied. Output is deterministic.
// To add an icon, add a row to GROUPS and rerun the script. A missing icon fails the run.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT_FILE = join(root, 'apps/web/src/components/workspace-icons/icons.generated.ts');
/** The regular-weight paths live in their own module so the picker can load them lazily. */
export const REGULAR_OUTPUT_FILE = join(
  root,
  'apps/web/src/components/workspace-icons/icons-regular.generated.ts',
);

/** [key, extra search keywords]. The label is the key with spaces. */
export const GROUPS = [
  {
    id: 'people-home',
    label: 'People and home',
    icons: [
      ['house', 'home'],
      ['house-line', 'home'],
      ['house-simple', 'home'],
      ['buildings', 'apartment flats city'],
      ['bed', 'bedroom sleep'],
      ['couch', 'sofa living room furniture'],
      ['bathtub', 'bathroom bath'],
      ['key', 'access keys'],
      ['door', 'entrance'],
      ['users', 'people team group family'],
      ['users-three', 'family people together team'],
      ['user-circle', 'person me profile'],
      ['baby', 'kids child'],
      ['baby-carriage', 'kids pram'],
      ['cake', 'birthday'],
      ['balloon', 'party birthday'],
      ['gift', 'present'],
      ['handshake', 'deal friends'],
      ['confetti', 'party celebration'],
      ['dog', 'pet animal'],
      ['cat', 'pet animal'],
      ['paw-print', 'pets animals'],
    ],
  },
  {
    id: 'work-money',
    label: 'Work and money',
    icons: [
      ['briefcase', 'job work'],
      ['suitcase-simple', 'job business'],
      ['storefront', 'shop store'],
      ['factory', 'industry'],
      ['building-office', 'company office'],
      ['wallet', 'money'],
      ['credit-card', 'payment money'],
      ['bank', 'finance'],
      ['coins', 'money cash'],
      ['currency-dollar', 'money price'],
      ['piggy-bank', 'savings money'],
      ['receipt', 'invoice bills'],
      ['shopping-cart', 'groceries shopping'],
      ['shopping-bag', 'shopping'],
      ['tag', 'price label'],
      ['chart-bar', 'report stats'],
      ['chart-line-up', 'growth sales stats'],
      ['chart-pie', 'report stats'],
      ['target', 'goal aim'],
      ['trophy', 'win award'],
      ['medal', 'award prize'],
      ['scales', 'legal law balance'],
      ['package', 'box stock delivery'],
      ['identification-badge', 'id hr'],
    ],
  },
  {
    id: 'planning',
    label: 'Planning',
    icons: [
      ['calendar-blank', 'calendar date'],
      ['calendar-check', 'event schedule'],
      ['clock', 'time'],
      ['timer', 'stopwatch'],
      ['hourglass', 'wait time'],
      ['kanban', 'project board'],
      ['list-checks', 'todo tasks checklist'],
      ['check-circle', 'done'],
      ['note-pencil', 'notes write'],
      ['notepad', 'notes'],
      ['push-pin', 'pin'],
      ['bookmark-simple', 'save'],
      ['flag', 'goal'],
      ['flag-banner', 'goal milestone'],
      ['map-trifold', 'map plan'],
      ['compass', 'explore direction'],
      ['path', 'route journey'],
    ],
  },
  {
    id: 'communication',
    label: 'Communication',
    icons: [
      ['chat-circle', 'message'],
      ['chats', 'discussion messages'],
      ['envelope-simple', 'mail email'],
      ['phone', 'call mobile'],
      ['megaphone', 'marketing announce'],
      ['bell', 'notifications alert'],
      ['at', 'mention email'],
      ['share-network', 'share'],
      ['link', 'url'],
      ['broadcast', 'live'],
      ['microphone', 'audio podcast'],
      ['video-camera', 'video'],
      ['tray', 'inbox'],
    ],
  },
  {
    id: 'health-food',
    label: 'Health and food',
    icons: [
      ['heart', 'love like favourite'],
      ['heartbeat', 'health pulse ecg bpm medical wellbeing'],
      ['first-aid-kit', 'health medical plaster doctor'],
      ['pill', 'medicine'],
      ['stethoscope', 'health doctor medical'],
      ['barbell', 'gym workout fitness'],
      ['person-simple-run', 'running exercise'],
      ['bicycle', 'cycling bike'],
      ['brain', 'mind'],
      ['tooth', 'dentist'],
      ['drop', 'water'],
      ['moon', 'night sleep'],
      ['flower-lotus', 'wellness yoga meditation spa'],
      ['fork-knife', 'food dinner restaurant'],
      ['coffee', 'tea cafe'],
      ['pizza', 'food'],
      ['hamburger', 'burger food'],
      ['carrot', 'vegetable food'],
      ['bread', 'baking bakery'],
      ['wine', 'drinks'],
      ['cooking-pot', 'cooking recipes'],
      ['orange-slice', 'fruit'],
      ['ice-cream', 'dessert'],
    ],
  },
  {
    id: 'travel',
    label: 'Travel and places',
    icons: [
      ['airplane-tilt', 'plane flight trip holiday'],
      ['car', 'drive'],
      ['bus', 'transport'],
      ['train', 'rail'],
      ['taxi', 'cab'],
      ['motorcycle', 'scooter bike'],
      ['boat', 'ship'],
      ['sailboat', 'sailing'],
      ['rocket-launch', 'rocket startup launch'],
      ['suitcase-rolling', 'luggage trip holiday'],
      ['tent', 'camping'],
      ['mountains', 'hiking'],
      ['island', 'beach holiday vacation'],
      ['globe-hemisphere-west', 'world earth'],
      ['map-pin', 'place location'],
      ['lighthouse', 'sea'],
      ['anchor', 'sea'],
      ['gas-pump', 'fuel'],
      ['person-simple-hike', 'walking hiking'],
      ['umbrella', 'rain weather'],
      ['binoculars', 'explore'],
    ],
  },
  {
    id: 'education',
    label: 'School and learning',
    icons: [
      ['graduation-cap', 'school education'],
      ['book-open', 'reading book'],
      ['books', 'library'],
      ['student', 'school'],
      ['pencil-simple', 'write'],
      ['exam', 'test quiz'],
      ['flask', 'science lab'],
      ['atom', 'science physics'],
      ['calculator', 'maths'],
      ['translate', 'languages'],
      ['lightbulb', 'idea'],
      ['puzzle-piece', 'puzzle'],
    ],
  },
  {
    id: 'creative',
    label: 'Creative and fun',
    icons: [
      ['palette', 'art paint'],
      ['paint-brush', 'art paint'],
      ['camera', 'photo'],
      ['film-slate', 'movie cinema'],
      ['music-notes', 'song'],
      ['guitar', 'music'],
      ['piano-keys', 'music'],
      ['headphones', 'music audio'],
      ['game-controller', 'games gaming'],
      ['dice-five', 'game dice'],
      ['mask-happy', 'theatre drama comedy'],
      ['pen-nib', 'drawing design'],
      ['scissors', 'craft'],
      ['magic-wand', 'magic'],
      ['sparkle', 'new'],
      ['star', 'favourite'],
      ['soccer-ball', 'football sport'],
      ['basketball', 'sport'],
      ['tennis-ball', 'sport'],
    ],
  },
  {
    id: 'tech',
    label: 'Tools and tech',
    icons: [
      ['code', 'developer programming'],
      ['terminal-window', 'command line'],
      ['bug', 'issue'],
      ['database', 'data'],
      ['cloud', 'storage'],
      ['cpu', 'chip'],
      ['desktop', 'computer pc'],
      ['laptop', 'computer'],
      ['device-mobile', 'phone'],
      ['wifi-high', 'network'],
      ['robot', 'ai bot'],
      ['lock', 'private secure'],
      ['shield-check', 'security safe verified'],
      ['gear', 'settings admin'],
      ['wrench', 'tools repair'],
      ['hammer', 'tools build'],
      ['toolbox', 'tools diy'],
      ['plugs', 'plug power'],
      ['lightning', 'bolt energy'],
      ['broom', 'cleaning chores'],
      ['paint-roller', 'decorating painting'],
      ['truck', 'delivery moving'],
    ],
  },
  {
    id: 'nature',
    label: 'Nature and animals',
    icons: [
      ['tree', 'forest park'],
      ['tree-palm', 'palm'],
      ['leaf', 'eco green'],
      ['plant', 'garden potted'],
      ['flower', 'garden'],
      ['cactus', 'desert'],
      ['sun', 'sunny weather'],
      ['cloud-sun', 'weather'],
      ['snowflake', 'winter snow'],
      ['fire', 'flame'],
      ['wind', 'air'],
      ['planet', 'space'],
      ['butterfly', 'insect'],
      ['bird', 'animal'],
      ['fish', 'animal'],
      ['rabbit', 'animal bunny'],
    ],
  },
  {
    id: 'shapes',
    label: 'Shapes and symbols',
    icons: [
      ['circle', 'dot'],
      ['square', 'box'],
      ['triangle', 'shape'],
      ['diamond', 'gem premium'],
      ['hexagon', 'shape'],
      ['cube', '3d box'],
      ['infinity', 'loop'],
      ['hash', 'number tag'],
      ['asterisk', 'star'],
      ['crown', 'king premium'],
      ['rainbow', 'colour'],
      ['smiley', 'happy face'],
      ['squares-four', 'dashboard overview grid'],
      ['folder-simple', 'files folder'],
    ],
  },
];

export const ICON_KEY_PATTERN = /^[a-z0-9-]{1,40}$/;

function pathData(file, key, weight) {
  if (!existsSync(file)) throw new Error(`Phosphor ${weight} icon "${key}" not found at ${file}`);
  const svg = readFileSync(file, 'utf8');
  if (!svg.includes('viewBox="0 0 256 256"')) throw new Error(`${key}: unexpected viewBox`);
  const paths = [...svg.matchAll(/<path d="([^"]+)"\s*\/>/g)].map((m) => m[1]);
  const shapes = (svg.match(/<(?!svg|path|\/)[a-z]+/g) ?? []).length;
  if (paths.length !== 1 || shapes)
    throw new Error(`${key} (${weight}): expected exactly one <path>`);
  return paths[0];
}

function collect() {
  // The package's `exports` map hides package.json, so locate the folder from the entry point.
  const require = createRequire(import.meta.url);
  const pkgDir = join(dirname(require.resolve('@phosphor-icons/core')), '..');
  const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
  const seen = new Set();
  const icons = [];
  for (const group of GROUPS) {
    for (const [key, keywords] of group.icons) {
      if (!ICON_KEY_PATTERN.test(key)) throw new Error(`Bad icon key ${key}`);
      if (seen.has(key)) throw new Error(`Duplicate icon key ${key}`);
      seen.add(key);
      icons.push({
        key,
        keywords,
        group: group.id,
        label: key.replace(/-/g, ' '),
        regular: pathData(join(pkgDir, 'assets/regular', `${key}.svg`), key, 'regular'),
        fill: pathData(join(pkgDir, 'assets/fill', `${key}-fill.svg`), key, 'fill'),
      });
    }
  }
  return { version, icons };
}

const banner = (
  version,
) => `// Generated by scripts/generate-workspace-icons.mjs. Do not edit by hand.
// Phosphor Icons, copyright Phosphor Icons, MIT
// (@phosphor-icons/core ${version}). Registered in docs/PROVENANCE.md.
// Modified for Atrium (AGPL-3.0-only), 2026-11-09: only the path data of a curated subset.
`;

/** icons.generated.ts: keys, labels, keywords, groups and the fill paths (loaded eagerly). */
export function render() {
  const { version, icons } = collect();
  const rows = icons.map(
    (i) =>
      `  { key: ${JSON.stringify(i.key)}, label: ${JSON.stringify(i.label)}, group: ${JSON.stringify(i.group)}, keywords: ${JSON.stringify(i.keywords)}, fill: ${JSON.stringify(i.fill)} },`,
  );
  const groups = GROUPS.map(
    (g) => `  { id: ${JSON.stringify(g.id)}, label: ${JSON.stringify(g.label)} },`,
  );
  return `${banner(version)}
export interface WorkspaceIconDef {
  readonly key: string;
  readonly label: string;
  readonly group: string;
  readonly keywords: string;
  /** Path data of the fill weight for \`viewBox="0 0 256 256"\`. */
  readonly fill: string;
}

export const WORKSPACE_ICON_GROUPS: readonly { readonly id: string; readonly label: string }[] = [
${groups.join('\n')}
];

export const WORKSPACE_ICONS: readonly WorkspaceIconDef[] = [
${rows.join('\n')}
];
`;
}

/** icons-regular.generated.ts: the regular paths by key (loaded with the picker). */
export function renderRegular() {
  const { version, icons } = collect();
  const rows = icons.map((i) => `  ${JSON.stringify(i.key)}: ${JSON.stringify(i.regular)},`);
  return `${banner(version)}
/** Regular-weight path data for \`viewBox="0 0 256 256"\`, by icon key. */
export const REGULAR_PATHS: Readonly<Record<string, string>> = {
${rows.join('\n')}
};
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputs = [
    [OUTPUT_FILE, render()],
    [REGULAR_OUTPUT_FILE, renderRegular()],
  ];
  const check = process.argv.includes('--check');
  let stale = false;
  for (const [file, next] of outputs) {
    if (check) {
      const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
      if (current !== next) {
        console.error(`${file} is stale. Run: pnpm icons:generate`);
        stale = true;
      }
    } else {
      writeFileSync(file, next);
      console.log(`Wrote ${file}`);
    }
  }
  if (stale) process.exit(1);
  if (check) console.log('Generated icon modules are up to date.');
}
