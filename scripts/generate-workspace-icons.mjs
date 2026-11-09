// Generates apps/web/src/components/workspace-icons/icons.generated.ts: a curated set of Material
// Symbols (outlined, weight 400) as SVG path data for workspace icons (docs/specs/WS-icons-material.md).
//
//   pnpm icons:generate          rewrite the module
//   pnpm icons:generate --check  fail when the committed module is stale (also run by a unit test)
//
// Source: the `@material-symbols/svg-400` devDependency (Apache-2.0, Google). The package is never
// imported at runtime; only the path data of the icons below is copied. Output is deterministic.
// To add an icon, add a row to GROUPS and rerun the script.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT_FILE = join(root, 'apps/web/src/components/workspace-icons/icons.generated.ts');

/** [key, extra search keywords]. The label is the key with spaces. */
export const GROUPS = [
  {
    id: 'people-home',
    label: 'People and home',
    icons: [
      ['home', 'house'],
      ['cottage', 'cabin house'],
      ['apartment', 'building flat'],
      ['villa', 'house garden'],
      ['family_home', 'house family'],
      ['bed', 'bedroom sleep'],
      ['chair_alt', 'furniture sofa'],
      ['weekend', 'sofa couch living room'],
      ['diversity_3', 'family people together'],
      ['groups', 'family team people'],
      ['person', 'me myself profile'],
      ['group', 'people team'],
      ['child_care', 'baby kids'],
      ['cake', 'birthday'],
      ['handshake', 'deal friends'],
      ['celebration', 'party'],
      ['elderly', 'grandparents'],
    ],
  },
  {
    id: 'work-money',
    label: 'Work and money',
    icons: [
      ['work', 'briefcase job'],
      ['business_center', 'briefcase job'],
      ['payments', 'money cash'],
      ['account_balance', 'bank finance'],
      ['savings', 'money piggy bank'],
      ['credit_card', 'money payment'],
      ['receipt_long', 'invoice bills'],
      ['trending_up', 'growth sales'],
      ['bar_chart', 'report stats'],
      ['pie_chart', 'report stats'],
      ['analytics', 'data report'],
      ['store', 'shop'],
      ['storefront', 'shop'],
      ['campaign', 'marketing megaphone'],
      ['inventory_2', 'box stock'],
      ['corporate_fare', 'company office'],
      ['badge', 'id hr'],
      ['contract', 'document legal'],
      ['work_history', 'career'],
    ],
  },
  {
    id: 'school',
    label: 'School and learning',
    icons: [
      ['school', 'education graduation'],
      ['menu_book', 'book reading'],
      ['auto_stories', 'book reading'],
      ['science', 'lab chemistry'],
      ['calculate', 'maths'],
      ['language', 'languages web'],
      ['history_edu', 'history writing'],
      ['draw', 'pencil'],
      ['edit_note', 'notes write'],
      ['psychology', 'brain mind'],
      ['local_library', 'books'],
      ['quiz', 'exam test'],
    ],
  },
  {
    id: 'health-food',
    label: 'Health and food',
    icons: [
      ['favorite', 'heart health love'],
      ['monitor_heart', 'health heartbeat'],
      ['medical_services', 'doctor health'],
      ['healing', 'plaster'],
      ['fitness_center', 'gym workout'],
      ['spa', 'wellness relax'],
      ['self_improvement', 'meditation yoga'],
      ['restaurant', 'food utensils dinner'],
      ['lunch_dining', 'burger food'],
      ['local_cafe', 'coffee tea'],
      ['bakery_dining', 'bread baking'],
      ['local_pizza', 'food'],
      ['icecream', 'dessert'],
      ['nutrition', 'fruit diet'],
    ],
  },
  {
    id: 'travel',
    label: 'Travel and transport',
    icons: [
      ['flight', 'plane travel trip holiday'],
      ['directions_car', 'car drive'],
      ['directions_bus', 'bus'],
      ['train', 'rail'],
      ['directions_bike', 'bicycle cycling'],
      ['sailing', 'boat'],
      ['luggage', 'suitcase trip holiday'],
      ['hotel', 'stay'],
      ['map', 'trip'],
      ['explore', 'compass'],
      ['beach_access', 'holiday vacation'],
      ['camping', 'tent'],
      ['hiking', 'walk'],
      ['local_taxi', 'cab'],
      ['two_wheeler', 'motorbike scooter'],
      ['commute', 'transport'],
      ['public', 'globe world earth'],
    ],
  },
  {
    id: 'nature',
    label: 'Nature and animals',
    icons: [
      ['park', 'tree'],
      ['forest', 'trees'],
      ['eco', 'leaf green'],
      ['potted_plant', 'garden plant'],
      ['yard', 'garden'],
      ['grass', 'garden lawn'],
      ['local_florist', 'flower garden'],
      ['pets', 'paw dog cat animals'],
      ['cruelty_free', 'rabbit animal'],
      ['flutter_dash', 'bird animal'],
      ['water_drop', 'water'],
      ['air', 'wind'],
      ['sunny', 'sun weather'],
      ['nightlight', 'moon night'],
      ['cloud', 'weather'],
      ['ac_unit', 'snow winter'],
    ],
  },
  {
    id: 'tools-tech',
    label: 'Tools and tech',
    icons: [
      ['build', 'tools wrench repair'],
      ['construction', 'building site'],
      ['handyman', 'tools diy'],
      ['hardware', 'tools hammer'],
      ['code', 'developer programming'],
      ['terminal', 'command line'],
      ['computer', 'desktop pc'],
      ['laptop_mac', 'computer'],
      ['call', 'phone mobile'],
      ['devices', 'screens'],
      ['router', 'network wifi'],
      ['memory', 'chip'],
      ['bolt', 'lightning energy'],
      ['settings', 'gear admin'],
      ['engineering', 'engineer'],
      ['electrical_services', 'plug power'],
      ['plumbing', 'pipes'],
      ['cleaning_services', 'cleaning chores'],
    ],
  },
  {
    id: 'fun',
    label: 'Fun and hobbies',
    icons: [
      ['sports_esports', 'games gaming'],
      ['sports_soccer', 'football sport'],
      ['sports_basketball', 'sport'],
      ['sports_tennis', 'sport'],
      ['palette', 'art paint'],
      ['brush', 'art paint'],
      ['music_note', 'music song'],
      ['headphones', 'music audio'],
      ['piano', 'music'],
      ['theater_comedy', 'theatre drama'],
      ['movie', 'film cinema'],
      ['photo_camera', 'camera photo'],
      ['videocam', 'video'],
      ['casino', 'dice game'],
      ['extension', 'puzzle'],
      ['toys', 'kids'],
      ['sports_bar', 'drinks beer'],
    ],
  },
  {
    id: 'symbols',
    label: 'Symbols and everyday',
    icons: [
      ['star', 'favourite'],
      ['rocket_launch', 'rocket launch startup'],
      ['lightbulb', 'idea light'],
      ['flag', 'goal'],
      ['bookmark', 'save'],
      ['diamond', 'gem premium'],
      ['trophy', 'win award'],
      ['verified', 'badge check'],
      ['shield', 'security safe'],
      ['lock', 'private secure'],
      ['key', 'access'],
      ['target', 'goal aim'],
      ['schedule', 'clock time'],
      ['calendar_month', 'calendar date'],
      ['folder', 'files'],
      ['event', 'calendar'],
      ['task_alt', 'done check'],
      ['checklist', 'todo tasks'],
      ['dashboard', 'overview'],
      ['view_kanban', 'project board'],
      ['inbox', 'mail'],
      ['mail', 'email'],
      ['chat', 'message'],
      ['forum', 'discussion'],
      ['notifications', 'bell'],
      ['shopping_cart', 'shopping groceries'],
      ['shopping_bag', 'shopping'],
      ['sell', 'tag price'],
      ['redeem', 'gift present'],
    ],
  },
];

export const ICON_KEY_PATTERN = /^[a-z0-9_]{1,40}$/;

function pathData(svgDir, key) {
  const file = join(svgDir, `${key}.svg`);
  if (!existsSync(file)) throw new Error(`Material Symbols icon "${key}" not found at ${file}`);
  const svg = readFileSync(file, 'utf8');
  if (!svg.includes('viewBox="0 -960 960 960"')) throw new Error(`${key}: unexpected viewBox`);
  const paths = [...svg.matchAll(/<path d="([^"]+)"\s*\/>/g)].map((m) => m[1]);
  const shapes = (svg.match(/<(?!svg|path|\/)[a-z]+/g) ?? []).length;
  if (paths.length !== 1 || shapes) throw new Error(`${key}: expected exactly one <path>`);
  return paths[0];
}

export function render() {
  const require = createRequire(import.meta.url);
  const pkgDir = dirname(require.resolve('@material-symbols/svg-400/package.json'));
  const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
  const svgDir = join(pkgDir, 'outlined');
  const seen = new Set();
  const rows = [];
  for (const group of GROUPS) {
    for (const [key, keywords] of group.icons) {
      if (!ICON_KEY_PATTERN.test(key)) throw new Error(`Bad icon key ${key}`);
      if (seen.has(key)) throw new Error(`Duplicate icon key ${key}`);
      seen.add(key);
      const label = key.replace(/_/g, ' ');
      rows.push(
        `  { key: ${JSON.stringify(key)}, label: ${JSON.stringify(label)}, group: ${JSON.stringify(group.id)}, keywords: ${JSON.stringify(keywords)}, path: ${JSON.stringify(pathData(svgDir, key))} },`,
      );
    }
  }
  const groups = GROUPS.map(
    (g) => `  { id: ${JSON.stringify(g.id)}, label: ${JSON.stringify(g.label)} },`,
  );
  return `// Generated by scripts/generate-workspace-icons.mjs. Do not edit by hand.
// Material Symbols (outlined, weight 400), copyright Google LLC, Apache-2.0
// (@material-symbols/svg-400 ${version}). Registered in docs/PROVENANCE.md.
// Modified for Atrium (AGPL-3.0-only), 2026-11-09: only the path data of a curated subset.

export interface WorkspaceIconDef {
  readonly key: string;
  readonly label: string;
  readonly group: string;
  readonly keywords: string;
  /** Path data for \`viewBox="0 -960 960 960"\`. */
  readonly path: string;
}

export const WORKSPACE_ICON_GROUPS: readonly { readonly id: string; readonly label: string }[] = [
${groups.join('\n')}
];

export const WORKSPACE_ICONS: readonly WorkspaceIconDef[] = [
${rows.join('\n')}
];
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const next = render();
  if (process.argv.includes('--check')) {
    const current = existsSync(OUTPUT_FILE) ? readFileSync(OUTPUT_FILE, 'utf8') : '';
    if (current !== next) {
      console.error('icons.generated.ts is stale. Run: pnpm icons:generate');
      process.exit(1);
    }
    console.log('icons.generated.ts is up to date.');
  } else {
    writeFileSync(OUTPUT_FILE, next);
    console.log(`Wrote ${OUTPUT_FILE}`);
  }
}
