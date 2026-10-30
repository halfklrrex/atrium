// The showcase content: a believable "Website relaunch" board with realistic fake data.
//
// Pure and deterministic. `buildShowcase()` returns the exact Firestore documents the seed script
// writes, every one built with the shared zod schemas and every cell value run through the shared
// column registry (`columnRegistry.parseValue`), so the data is what the app itself would write.
// Anything invalid throws, loudly.
//
// EXTENDING (AGENTS.md rule): when a feature or column type lands that is visible on a board, add
// it here in the same PR. See docs/showcase.md.
import {
  DEFAULT_BOARD_STATUS_LABELS,
  boardSchema,
  boardViewSchema,
  columnDefSchema,
  columnRegistry,
  defaultSubitemColumns,
  favoriteSchema,
  groupDefSchema,
  itemSchema,
  itemUpdateSchema,
  notificationSchema,
  recentSchema,
  updateReplySchema,
  workspaceMemberSchema,
} from '@atrium/shared';

/**
 * PENDING_TYPES: column types registered in `packages/shared` that the web board table cannot
 * render yet (no entry in `apps/web/src/columns/registry.ts`). The table draws an unknown type as a
 * blank cell under a bare header, so showing them would look broken. They are left out until their
 * UI lands. When one does, move it into `COLUMNS` below and remove it from this list; the drift test
 * in `showcase.test.mjs` fails until you do.
 */
export const PENDING_TYPES = [
  'dependency',
  'board_relation',
  'mirror',
  'button',
  'files',
  'formula',
  'time_tracking',
];

/** Board ids the seed script owns. Anything else is off limits (see `isOwnedPath`). */
export const SHOWCASE_MAIN_ID = 'showcase-main';
export const SHOWCASE_ARCHIVED_ID = 'showcase-archived-demo';
export const SHOWCASE_TRASHED_ID = 'showcase-trashed-demo';
export const SHOWCASE_BOARD_IDS = [SHOWCASE_MAIN_ID, SHOWCASE_ARCHIVED_ID, SHOWCASE_TRASHED_ID];
export const SHOWCASE_PREFIX = 'showcase-';
/** The owner's three showcase notifications (`users/{owner}/notifications/<id>`), one per kind. */
export const SHOWCASE_NOTIFICATION_PREFIX = 'showcase-notification-';
export const SHOWCASE_NOTIFICATION_IDS = ['mention', 'reply', 'assigned'].map(
  (kind) => `${SHOWCASE_NOTIFICATION_PREFIX}${kind}`,
);

/**
 * Three fake people, so People cells show names and initials instead of "Board member". They get a
 * `workspaces/{id}/members/{uid}` profile doc ONLY: they are not in the workspace's `roles` or
 * `memberIds`, so they are not real accounts, cannot sign in and never appear in the Members dialog.
 */
export const SHOWCASE_MEMBERS = [
  { key: 'jordan', uid: 'showcase-user-jordan', displayName: 'Jordan Lee' },
  { key: 'sam', uid: 'showcase-user-sam', displayName: 'Sam Rivera' },
  { key: 'casey', uid: 'showcase-user-casey', displayName: 'Casey Morgan' },
].map((m) => ({ ...m, email: `${m.displayName.toLowerCase().replace(' ', '.')}@example.com` }));
export const SHOWCASE_MEMBER_UIDS = SHOWCASE_MEMBERS.map((m) => m.uid);
const memberUid = (key) => {
  const member = SHOWCASE_MEMBERS.find((m) => m.key === key);
  if (!member) throw new Error(`Unknown showcase member "${key}"`);
  return member.uid;
};

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** A Firestore timestamp stand-in that satisfies the shared `timestampSchema`. */
export class ShowcaseTimestamp {
  constructor(ms) {
    if (!Number.isFinite(ms)) throw new Error(`Invalid timestamp: ${ms}`);
    this.ms = Math.floor(ms);
  }
  get seconds() {
    return Math.floor(this.ms / 1000);
  }
  get nanoseconds() {
    return (this.ms % 1000) * 1_000_000;
  }
  toDate() {
    return new Date(this.ms);
  }
  toMillis() {
    return this.ms;
  }
}

/** The "today" the content is laid out around: midnight UTC of the given instant. */
export function anchorOf(now = new Date()) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Fractional-indexing style keys (`a0`..`az`) for the first 62 siblings. */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function orderKey(index) {
  if (!Number.isInteger(index) || index < 0 || index >= DIGITS.length) {
    throw new Error(`orderKey supports 0..${DIGITS.length - 1}, got ${index}`);
  }
  return `a${DIGITS[index]}`;
}

// ---------------------------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------------------------

const STATUS_LABELS = [
  ...DEFAULT_BOARD_STATUS_LABELS.filter((l) => l.index !== 5),
  { id: 'review_purple', index: 3, label: 'Waiting for review', color: '#a25ddc' },
  DEFAULT_BOARD_STATUS_LABELS.find((l) => l.index === 5),
];
const STATUS = { working: 0, done: 1, stuck: 2, review: 3 };

const PRIORITY_LABELS = [
  { id: 'critical', index: 0, label: 'Critical', color: '#333333' },
  { id: 'high', index: 1, label: 'High', color: '#401694' },
  { id: 'medium', index: 2, label: 'Medium', color: '#5559df' },
  { id: 'low', index: 3, label: 'Low', color: '#579bfc' },
  { id: 'priority_empty', index: 5, label: '', color: '#c4c4c4' },
];
const PRIORITY = { critical: 0, high: 1, medium: 2, low: 3 };

const AREA_LABELS = [
  { id: 1, label: 'Design' },
  { id: 2, label: 'Engineering' },
  { id: 3, label: 'Content' },
  { id: 4, label: 'Marketing' },
  { id: 5, label: 'Legal' },
];
const AREA = { design: 1, engineering: 2, content: 3, marketing: 4, legal: 5 };

/** Every column type the web board table can render today, in table order. */
const COLUMNS = [
  { id: 'person', type: 'people', title: 'Owner', settings: {} },
  { id: 'status', type: 'status', title: 'Status', settings: { labels: STATUS_LABELS } },
  { id: 'priority', type: 'status', title: 'Priority', settings: { labels: PRIORITY_LABELS } },
  { id: 'due', type: 'date', title: 'Due date', settings: {} },
  {
    id: 'budget',
    type: 'numbers',
    title: 'Budget',
    settings: { unit: { symbol: '€', direction: 'left' }, decimals: 0 },
  },
  { id: 'area', type: 'dropdown', title: 'Area', settings: { labels: AREA_LABELS } },
  { id: 'next_step', type: 'text', title: 'Next step', settings: {} },
  { id: 'brief', type: 'long_text', title: 'Brief', settings: {} },
  { id: 'approved', type: 'checkbox', title: 'Approved', settings: {} },
  { id: 'link', type: 'link', title: 'Link', settings: {} },
  { id: 'rating', type: 'rating', title: 'Rating', settings: { limit: 5, symbol: 'stars' } },
  { id: 'vote', type: 'vote', title: 'Votes', settings: {} },
  { id: 'color', type: 'color_picker', title: 'Color', settings: {} },
  { id: 'country', type: 'country', title: 'Country', settings: {} },
  { id: 'contact_email', type: 'email', title: 'Email', settings: {} },
  { id: 'phone', type: 'phone', title: 'Phone', settings: {} },
  {
    id: 'tags',
    type: 'tags',
    title: 'Tags',
    settings: {
      tags: [
        { id: 1, name: 'Frontend', color: '#579bfc' },
        { id: 2, name: 'Backend', color: '#037f4c' },
        { id: 3, name: 'Design', color: '#a25ddc' },
      ],
    },
  },
  {
    id: 'progress',
    type: 'progress',
    title: 'Progress',
    settings: { related_columns: { isNormalized: true, columns: {} } },
  },
  // Number and Item ID are derived from `boardSeq` / `seq`, which the onItemCreated function assigns
  // to every new item: the seed never writes those fields or any value for these two columns.
  {
    id: 'auto_number',
    type: 'auto_number',
    title: 'Number',
    settings: { scope: 'board', order: 'ascending' },
  },
  { id: 'item_id', type: 'item_id', title: 'Item ID', settings: { displayType: 'id' } },
  {
    id: 'creation_log',
    type: 'creation_log',
    title: 'Created',
    settings: { mode: 'personAndDate' },
  },
  {
    id: 'last_updated',
    type: 'last_updated',
    title: 'Updated',
    settings: { mode: 'personAndDate' },
  },
  { id: 'timeline', type: 'timeline', title: 'Timeline', settings: { showProgress: true } },
  {
    id: 'week',
    type: 'week',
    title: 'Week',
    settings: { firstDayOfWeek: 'monday' },
  },
  { id: 'hour', type: 'hour', title: 'Hour', settings: { format24Hour: true } },
  {
    id: 'world_clock',
    type: 'world_clock',
    title: 'World clock',
    settings: { format24Hour: true, showCity: true },
  },
  { id: 'location', type: 'location', title: 'Location', settings: {} },
];

/** Column types the main showcase board uses (checked against the web registry by a test). */
export const SHOWCASE_COLUMN_TYPES = [...new Set(COLUMNS.map((c) => c.type))];

/** Build and validate the column definitions. Settings go through the registry's settings schema. */
function buildColumns() {
  return COLUMNS.map((column, i) => {
    const settings = columnRegistry.parseSettings(column.type, column.settings);
    if (!settings.success) {
      throw new Error(`Invalid settings for column "${column.title}": ${settings.error}`);
    }
    return columnDefSchema.parse({
      id: column.id,
      type: column.type,
      title: column.title,
      position: orderKey(i),
      settings: settings.data,
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------------------------

const GROUPS = [
  { id: 'this_week', title: 'This week', color: '#579bfc' },
  { id: 'next_up', title: 'Next up', color: '#a25ddc' },
  { id: 'backlog', title: 'Backlog', color: '#fdab3d' },
  { id: 'done', title: 'Done', color: '#037f4c' },
];

function buildGroups(list = GROUPS) {
  return list.map((group, i) => groupDefSchema.parse({ ...group, position: orderKey(i) }));
}

// ---------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------

/**
 * Rich-text description of an item (full item view): blocks `{ h }` (heading), `{ p }`, `{ ul }`
 * (bullets), `{ todo: [[text, checked]] }` (checklist), turned into a ProseMirror doc plus its text.
 */
function descriptionOf(blocks) {
  const text = (t) => ({ type: 'text', text: t });
  const para = (t) => ({ type: 'paragraph', content: [text(t)] });
  const content = blocks.map((b) => {
    if (b.h) return { type: 'heading', attrs: { level: 2 }, content: [text(b.h)] };
    if (b.ul) {
      return {
        type: 'bulletList',
        content: b.ul.map((t) => ({ type: 'listItem', content: [para(t)] })),
      };
    }
    if (b.todo) {
      return {
        type: 'taskList',
        content: b.todo.map(([t, checked]) => ({
          type: 'taskItem',
          attrs: { checked },
          content: [para(t)],
        })),
      };
    }
    return para(b.p);
  });
  const plain = blocks
    .flatMap((b) => b.h ?? b.p ?? b.ul ?? b.todo.map(([t]) => t))
    .join('\n')
    .slice(0, 10000);
  return { doc: { type: 'doc', content }, text: plain };
}

/**
 * Compact item description. `due` is days from today (negative = past), `created` is days ago.
 * Omit a field to leave the cell empty. `owner: true` puts the board owner in the people cell;
 * `people: ['jordan', 'sam']` adds fake members (see SHOWCASE_MEMBERS) to it.
 */
const ITEMS = [
  // ---- This week ----
  {
    key: 'hero-copy',
    description: [
      { h: 'Goal' },
      { p: 'Pick the tagline and lock the hero copy so design can finish the section.' },
      { h: 'Shortlist' },
      {
        ul: ['Everything in one place', 'Plan together, finish together', 'Work, simply organised'],
      },
      {
        todo: [
          ['Collect feedback from the team', true],
          ['Run a quick poll', false],
          ['Sign off', false],
        ],
      },
    ],
    people: ['jordan'],
    group: 'this_week',
    name: 'Finalize homepage hero copy',
    owner: true,
    status: 'working',
    priority: 'high',
    due: 1,
    budget: 1200,
    area: ['content'],
    next: 'Pick the final tagline',
    brief:
      'Three tagline options are shortlisted. We need a decision before design can lock the hero section.',
    link: ['https://example.com/relaunch/hero-copy', 'Copy doc'],
    rating: 5,
    vote: ['owner-uid', 'usr-sarah'],
    color: '#579bfc',
    country: { code: 'US', name: 'United States' },
    email: { email: 'sarah.copy@example.com', text: 'Sarah Connor' },
    phone: { phone: '+1 202-555-0143', countryShortName: 'US' },
    tags: [3],
    timeline: [-2, 3],
    week: [-5, 1],
    hour: { hour: 10, minute: 0 },
    worldClock: 'America/New_York',
    location: { lat: 40.7128, lng: -74.006, address: 'New York, NY' },
    created: 12,
    updates: [
      {
        id: 'hero-copy-u1',
        ago: 5 * DAY + 3 * HOUR,
        content:
          'Shortlisted three taglines after the workshop. Leaning towards option B: short, concrete, no jargon.',
        likes: true,
      },
      {
        id: 'hero-copy-u2',
        ago: 1 * DAY + 6 * HOUR,
        content: 'Sent all three options to the founders for a vote. Decision expected tomorrow.',
        replies: [
          {
            id: 'hero-copy-u2-r1',
            ago: 1 * DAY + 2 * HOUR,
            content: 'Votes are in: B wins 3 to 1.',
          },
        ],
      },
    ],
  },
  {
    key: 'pricing-page',
    description: [
      { h: 'Context' },
      {
        p: 'The current page buries the free tier. The redesign should make the three plans comparable at a glance.',
      },
      { ul: ['Plan cards with a clear highlight', 'FAQ underneath', 'Annual toggle'] },
    ],
    people: ['sam', 'casey'],
    group: 'this_week',
    name: 'Design new pricing page',
    owner: true,
    status: 'stuck',
    priority: 'critical',
    due: -2,
    budget: 4500,
    area: ['design'],
    next: 'Get final plan names from product',
    brief:
      'Three tiers instead of four, annual toggle on top, comparison table below the fold. Mockups are ready except for the plan names.',
    link: ['https://example.com/design/pricing', 'Pricing mockups'],
    rating: 4,
    vote: ['usr-marcus', 'usr-sarah', 'usr-elena'],
    color: '#a25ddc',
    country: { code: 'DE', name: 'Germany' },
    email: { email: 'marcus.pricing@example.com', text: 'Marcus Bauer' },
    phone: { phone: '+49 30 123456', countryShortName: 'DE' },
    tags: [1, 3],
    timeline: [-5, 2],
    week: [-5, 1],
    hour: { hour: 14, minute: 30 },
    worldClock: 'Europe/Berlin',
    location: { lat: 52.52, lng: 13.405, address: 'Berlin, Germany' },
    created: 20,
    updates: [
      {
        id: 'pricing-page-u1',
        ago: 6 * DAY,
        content:
          'Kicked off the new layout: three tiers, annual toggle, and a simpler comparison table. First mockups are in the design folder.',
        likes: true,
      },
      {
        id: 'pricing-page-u2',
        ago: 2 * DAY + 4 * HOUR,
        content:
          'Blocked on the final plan names from product. Without them the comparison table is full of placeholders. Pinging them again today.',
        replies: [
          {
            id: 'pricing-page-u2-r1',
            ago: 2 * DAY,
            content: 'Raised it in standup. Product promised an answer by Thursday.',
          },
          {
            id: 'pricing-page-u2-r2',
            ago: 6 * HOUR,
            content: 'Still no names. I will keep the status on Stuck until they confirm.',
          },
        ],
      },
    ],
  },
  {
    key: 'staging',
    people: ['jordan', 'sam'],
    group: 'this_week',
    name: 'Set up staging environment',
    owner: true,
    status: 'done',
    priority: 'high',
    due: -1,
    budget: 800,
    area: ['engineering'],
    approved: true,
    link: ['https://example.com/staging', 'Staging site'],
    rating: 3,
    vote: ['usr-alex'],
    color: '#037f4c',
    country: { code: 'GB', name: 'United Kingdom' },
    email: { email: 'devops@example.com', text: 'DevOps Team' },
    tags: [2],
    timeline: [-8, -1],
    week: [-12, -6],
    hour: { hour: 9, minute: 15 },
    worldClock: 'Europe/London',
    location: { lat: 51.5074, lng: -0.1278, address: 'London, UK' },
    created: 15,
  },
  {
    key: 'blog-migration',
    people: ['casey'],
    group: 'this_week',
    name: 'Migrate blog posts to the new CMS',
    owner: true,
    status: 'working',
    priority: 'medium',
    due: 4,
    budget: 2200,
    area: ['engineering', 'content'],
    next: 'Run the import dry-run on 40 posts',
    brief: 'About 120 posts, with images and redirects. Start with the 40 most visited.',
    rating: 3,
    country: { code: 'FR', name: 'France' },
    email: { email: 'elena.cms@example.com', text: 'Elena Dubois' },
    tags: [1, 2],
    timeline: [0, 7],
    week: [-5, 1],
    hour: { hour: 16, minute: 0 },
    worldClock: 'Europe/Paris',
    location: { lat: 48.8566, lng: 2.3522, address: 'Paris, France' },
    created: 9,
  },
  {
    key: 'privacy-policy',
    group: 'this_week',
    name: 'Legal review of privacy policy',
    status: 'review',
    priority: 'high',
    due: 2,
    budget: 1500,
    area: ['legal'],
    next: 'Wait for counsel feedback',
    approved: false,
    link: ['https://example.com/legal/privacy-draft-v3'],
    vote: ['owner-uid'],
    color: '#fdab3d',
    country: { code: 'DE', name: 'Germany' },
    email: { email: 'legal@example.com', text: 'Legal Counsel' },
    phone: { phone: '+49 89 987654', countryShortName: 'DE' },
    timeline: [-3, 4],
    week: [-5, 1],
    hour: { hour: 11, minute: 30 },
    worldClock: 'Europe/Berlin',
    created: 8,
    updates: [
      {
        id: 'privacy-policy-u1',
        ago: 3 * DAY,
        content:
          'Draft v3 sent to counsel. Main open question: how we describe analytics cookies on the new site.',
        likes: true,
        replies: [
          {
            id: 'privacy-policy-u1-r1',
            ago: 1 * DAY + 5 * HOUR,
            content:
              'Counsel confirmed a short summary plus a link to the full cookie table is fine.',
          },
        ],
      },
    ],
  },
  {
    key: 'a11y-audit',
    description: [
      { h: 'Scope' },
      {
        p: 'Audit the marketing site against WCAG 2.2 AA: keyboard use, contrast, focus order and screen reader labels.',
      },
      {
        todo: [
          ['Keyboard walkthrough', true],
          ['Contrast check', true],
          ['Screen reader pass', false],
          ['Write up findings', false],
        ],
      },
    ],
    people: ['sam'],
    group: 'this_week',
    name: 'Accessibility audit (WCAG AA)',
    owner: true,
    status: 'working',
    priority: 'high',
    due: -1,
    budget: 3000,
    area: ['engineering', 'design'],
    next: 'Fix contrast issues in the footer',
    brief: 'Automated pass done. Manual keyboard and screen reader pass still open for checkout.',
    rating: 4,
    vote: ['usr-alex', 'owner-uid'],
    color: '#e2445c',
    country: { code: 'US', name: 'United States' },
    email: { email: 'a11y-lead@example.com', text: 'Jordan Lee' },
    tags: [1],
    timeline: [-4, 1],
    week: [-5, 1],
    hour: { hour: 15, minute: 45 },
    worldClock: 'America/Los_Angeles',
    location: { lat: 37.7749, lng: -122.4194, address: 'San Francisco, CA' },
    created: 11,
    updates: [
      {
        id: 'a11y-audit-u1',
        ago: 2 * DAY + 1 * HOUR,
        content:
          'Automated scan found 14 issues, mostly colour contrast in the footer and missing form labels. Fixing the form labels first, since they affect the sign-up flow.',
      },
    ],
  },
  {
    key: 'newsletter-teaser',
    group: 'this_week',
    name: 'Kick off newsletter teaser',
    priority: 'low',
    due: 6,
    area: ['marketing'],
    rating: 2,
    color: '#579bfc',
    tags: [3],
    timeline: [1, 8],
    week: [2, 8],
    hour: { hour: 13, minute: 0 },
    worldClock: 'Europe/London',
    created: 4,
  },

  // ---- Next up ----
  {
    key: 'responsive-nav',
    group: 'next_up',
    name: 'Build responsive navigation',
    owner: true,
    priority: 'medium',
    due: 8,
    budget: 2600,
    area: ['engineering'],
    rating: 4,
    vote: ['usr-alex'],
    color: '#579bfc',
    country: { code: 'GB', name: 'United Kingdom' },
    phone: { phone: '+44 20 7946 0912', countryShortName: 'GB' },
    tags: [1],
    timeline: [3, 10],
    week: [2, 8],
    hour: { hour: 11, minute: 0 },
    worldClock: 'Europe/London',
    created: 7,
  },
  {
    key: 'team-photos',
    people: ['jordan', 'casey'],
    group: 'next_up',
    name: 'Photography brief for the team page',
    priority: 'low',
    due: 12,
    budget: 900,
    area: ['design', 'marketing'],
    rating: 3,
    color: '#a25ddc',
    country: { code: 'GB', name: 'United Kingdom' },
    email: { email: 'studio@example.com', text: 'Studio Foto' },
    phone: { phone: '+44 20 7946 0123', countryShortName: 'GB' },
    tags: [3],
    timeline: [7, 14],
    week: [9, 15],
    hour: { hour: 10, minute: 30 },
    worldClock: 'Europe/Berlin',
    created: 6,
  },
  {
    key: 'case-study',
    people: ['casey'],
    group: 'next_up',
    name: 'Write case study: Northwind',
    owner: true,
    status: 'working',
    priority: 'medium',
    due: 10,
    budget: 1800,
    area: ['content'],
    next: 'Second interview on Monday',
    brief: 'Two interviews with their ops lead, then a one-page layout with three metrics.',
    rating: 5,
    vote: ['owner-uid', 'usr-sarah'],
    country: { code: 'US', name: 'United States' },
    email: { email: 'press@northwind.example.com', text: 'Northwind PR' },
    timeline: [2, 12],
    week: [2, 8],
    hour: { hour: 17, minute: 0 },
    worldClock: 'America/Chicago',
    location: { lat: 41.8781, lng: -87.6298, address: 'Chicago, IL' },
    created: 10,
  },
  {
    key: 'analytics-cookies',
    group: 'next_up',
    name: 'Set up analytics and cookie banner',
    status: 'review',
    priority: 'high',
    due: 9,
    budget: 1100,
    area: ['engineering', 'legal'],
    approved: false,
    color: '#037f4c',
    country: { code: 'FR', name: 'France' },
    tags: [1, 2],
    timeline: [4, 11],
    week: [2, 8],
    hour: { hour: 14, minute: 0 },
    worldClock: 'Europe/Paris',
    created: 5,
  },
  {
    key: 'redirect-map',
    group: 'next_up',
    name: 'Redirect map for old URLs',
    owner: true,
    priority: 'critical',
    due: 14,
    budget: 600,
    area: ['engineering'],
    next: 'Export the top 200 URLs from analytics',
    rating: 4,
    tags: [2],
    timeline: [8, 16],
    week: [9, 15],
    hour: { hour: 9, minute: 0 },
    worldClock: 'UTC',
    created: 5,
  },
  {
    key: 'german',
    group: 'next_up',
    name: 'Localise the site to German',
    priority: 'medium',
    due: 21,
    budget: 5200,
    area: ['content'],
    brief: 'Needs a translation vendor and a review round with a native speaker.',
    rating: 5,
    vote: ['usr-marcus'],
    country: { code: 'GB', name: 'United Kingdom' },
    email: { email: 'translations@example.com', text: 'Translation Agency' },
    phone: { phone: '+44 20 7946 0456', countryShortName: 'GB' },
    timeline: [10, 24],
    week: [9, 15],
    hour: { hour: 12, minute: 0 },
    worldClock: 'America/New_York',
    created: 3,
  },
  {
    key: 'press-kit',
    group: 'next_up',
    name: 'Refresh the press kit',
    priority: 'low',
    due: 18,
    budget: 700,
    area: ['marketing'],
    link: ['https://example.com/press'],
    rating: 2,
    color: '#fdab3d',
    country: { code: 'US', name: 'United States' },
    email: { email: 'press@example.com' },
    timeline: [12, 19],
    week: [9, 15],
    hour: { hour: 15, minute: 0 },
    worldClock: 'America/New_York',
    created: 3,
  },

  // ---- Backlog ----
  {
    key: 'product-tour',
    group: 'backlog',
    name: 'Interactive product tour',
    priority: 'low',
    budget: 6000,
    area: ['design', 'engineering'],
    brief: 'A guided click-through of the dashboard on the homepage. Nice to have for launch.',
    rating: 4,
    vote: ['owner-uid', 'usr-elena'],
    color: '#579bfc',
    tags: [1, 3],
    timeline: [20, 35],
    worldClock: 'America/Los_Angeles',
    created: 16,
  },
  {
    key: 'logo-wall',
    group: 'backlog',
    name: 'Customer logo wall',
    priority: 'low',
    due: 28,
    budget: 300,
    area: ['design'],
    next: 'Collect logo permissions',
    rating: 3,
    tags: [3],
    timeline: [22, 30],
    hour: { hour: 16, minute: 30 },
    worldClock: 'Europe/London',
    created: 14,
  },
  {
    key: 'dark-mode',
    group: 'backlog',
    name: 'Dark mode for the marketing site',
    priority: 'low',
    budget: 2400,
    area: ['design', 'engineering'],
    rating: 5,
    vote: ['usr-alex', 'usr-sarah', 'usr-marcus', 'usr-elena'],
    color: '#333333',
    tags: [1, 3],
    timeline: [25, 40],
    worldClock: 'UTC',
    created: 13,
  },
  {
    key: 'chatbot',
    group: 'backlog',
    name: 'Chatbot for pricing questions',
    status: 'stuck',
    priority: 'low',
    due: -5,
    budget: 3500,
    area: ['engineering'],
    next: 'Decide: build or buy',
    rating: 2,
    vote: ['owner-uid'],
    country: { code: 'US', name: 'United States' },
    timeline: [-10, 0],
    hour: { hour: 18, minute: 0 },
    worldClock: 'America/New_York',
    created: 25,
  },
  {
    key: 'annual-report',
    group: 'backlog',
    name: 'Annual report microsite',
    priority: 'medium',
    due: 30,
    budget: 4000,
    area: ['content', 'design'],
    rating: 3,
    country: { code: 'GB', name: 'United Kingdom' },
    email: { email: 'finance@example.com' },
    tags: [3],
    timeline: [20, 32],
    worldClock: 'Europe/London',
    created: 9,
  },
  {
    key: 'referral-page',
    group: 'backlog',
    name: 'Referral programme landing page',
    owner: true,
    priority: 'medium',
    budget: 1500,
    area: ['marketing'],
    rating: 4,
    color: '#037f4c',
    timeline: [18, 28],
    hour: { hour: 11, minute: 0 },
    worldClock: 'America/Chicago',
    created: 8,
  },

  // ---- Done ----
  {
    key: 'kickoff',
    people: ['jordan', 'sam', 'casey'],
    group: 'done',
    name: 'Kick-off workshop with stakeholders',
    owner: true,
    status: 'done',
    priority: 'high',
    due: -26,
    budget: 600,
    area: ['marketing', 'design'],
    approved: true,
    rating: 5,
    vote: ['owner-uid', 'usr-sarah', 'usr-alex', 'usr-marcus'],
    color: '#037f4c',
    country: { code: 'DE', name: 'Germany' },
    email: { email: 'workshop@example.com' },
    phone: { phone: '+49 30 987654', countryShortName: 'DE' },
    tags: [3],
    timeline: [-29, -25],
    week: [-33, -27],
    hour: { hour: 9, minute: 0 },
    worldClock: 'Europe/Berlin',
    created: 29,
  },
  {
    key: 'competitor-audit',
    group: 'done',
    name: 'Competitor audit',
    owner: true,
    status: 'done',
    priority: 'medium',
    due: -22,
    budget: 400,
    area: ['marketing'],
    approved: true,
    rating: 4,
    vote: ['owner-uid'],
    country: { code: 'US', name: 'United States' },
    timeline: [-26, -20],
    week: [-26, -20],
    hour: { hour: 14, minute: 0 },
    worldClock: 'America/New_York',
    created: 28,
  },
  {
    key: 'brand-refresh',
    group: 'done',
    name: 'Brand colour and type refresh',
    owner: true,
    status: 'done',
    priority: 'high',
    due: -18,
    budget: 2800,
    area: ['design'],
    approved: true,
    link: ['https://example.com/brand', 'Brand guidelines'],
    rating: 5,
    vote: ['owner-uid', 'usr-sarah', 'usr-elena'],
    color: '#a25ddc',
    country: { code: 'FR', name: 'France' },
    email: { email: 'brand.lead@example.com', text: 'Camille Laurent' },
    phone: { phone: '+33 1 42 68 55 00', countryShortName: 'FR' },
    tags: [3],
    timeline: [-24, -16],
    week: [-26, -20],
    hour: { hour: 15, minute: 30 },
    worldClock: 'Europe/Paris',
    created: 27,
  },
  {
    key: 'sitemap',
    group: 'done',
    name: 'Sitemap and information architecture',
    owner: true,
    status: 'done',
    priority: 'high',
    due: -14,
    budget: 900,
    area: ['content', 'design'],
    approved: true,
    rating: 4,
    tags: [1, 3],
    timeline: [-18, -12],
    week: [-19, -13],
    hour: { hour: 10, minute: 0 },
    worldClock: 'UTC',
    created: 24,
  },
  {
    key: 'hosting',
    group: 'done',
    name: 'Pick hosting and CDN',
    owner: true,
    status: 'done',
    priority: 'medium',
    due: -10,
    budget: 150,
    area: ['engineering'],
    approved: true,
    rating: 5,
    vote: ['usr-alex', 'owner-uid'],
    color: '#037f4c',
    country: { code: 'JP', name: 'Japan' },
    email: { email: 'noc@example.com', text: 'Cloud Infrastructure' },
    tags: [2],
    timeline: [-14, -8],
    week: [-19, -13],
    hour: { hour: 8, minute: 0 },
    worldClock: 'Asia/Tokyo',
    location: { lat: 35.6762, lng: 139.6503, address: 'Tokyo, Japan' },
    created: 20,
  },
  {
    key: 'content-inventory',
    group: 'done',
    name: 'Content inventory',
    status: 'done',
    priority: 'low',
    due: -8,
    budget: 350,
    area: ['content'],
    approved: true,
    rating: 4,
    country: { code: 'GB', name: 'United Kingdom' },
    timeline: [-12, -7],
    week: [-12, -6],
    hour: { hour: 16, minute: 0 },
    worldClock: 'Europe/London',
    created: 19,
  },
];

/** Items that are archived or in the trash, so the Archive & Trash views have something to show. */
const SIDELINED_ITEMS = [
  {
    key: 'old-ab-test',
    state: 'archived',
    group: 'done',
    name: 'Old homepage A/B test (superseded)',
    status: 'done',
    priority: 'low',
    due: -20,
    budget: 500,
    area: ['marketing'],
    created: 27,
    changed: 12,
  },
  {
    key: 'legacy-audit',
    state: 'archived',
    group: 'done',
    name: 'Legacy microsite audit',
    status: 'done',
    priority: 'low',
    due: -16,
    area: ['content'],
    created: 26,
    changed: 9,
  },
  {
    key: 'duplicate-pricing',
    state: 'deleted',
    group: 'backlog',
    name: 'Duplicate: pricing page copy',
    priority: 'medium',
    budget: 1200,
    area: ['content'],
    created: 18,
    deletedDaysAgo: 1,
  },
  {
    key: 'test-item',
    state: 'deleted',
    group: 'backlog',
    name: 'Test item (ignore)',
    created: 14,
    deletedDaysAgo: 3,
  },
];

// ---------------------------------------------------------------------------------------------
// Subitems (P1): the board's `subitemColumns` are monday's defaults (Owner, Status, Date)
// ---------------------------------------------------------------------------------------------

/** Subitems by the `key` of their parent item. `due` is days from today, `status` as in ITEMS. */
const SUBITEMS = {
  'hero-copy': [
    { name: 'Write three tagline options', status: 'done', owner: true, due: -2 },
    { name: 'Collect feedback from the team', status: 'working', owner: true, due: 1 },
    { name: 'Pick the final tagline', status: 'review', due: 2 },
  ],
  'pricing-page': [
    { name: 'Draft the plan comparison table', status: 'working', owner: true, due: 3 },
    { name: 'Legal review of the pricing terms', status: 'stuck', due: -1 },
  ],
  staging: [
    { name: 'Set up the staging domain', status: 'done', owner: true, due: -4 },
    { name: 'Add basic auth', status: 'done', due: -3 },
    { name: 'Smoke-test the deploy pipeline', status: 'working', owner: true, due: 0 },
  ],
  'responsive-nav': [
    { name: 'Mobile menu prototype', status: 'working', owner: true, due: 5 },
    { name: 'Keyboard and screen reader pass', due: 7 },
  ],
};

/** The raw values of a subitem description (keys are the default subitem column ids). */
function subitemRawValues(spec, ownerUid, anchor) {
  const values = {};
  if (spec.owner) values.sub_owner = { personsAndTeams: [{ id: ownerUid, kind: 'person' }] };
  if (spec.status) values.sub_status = { index: STATUS[spec.status] };
  if (spec.due !== undefined) values.sub_date = { date: isoDate(anchor, spec.due) };
  return values;
}

/** Date `offset` days from the anchor, as `YYYY-MM-DD`. */
function isoDate(anchor, offset) {
  return new Date(anchor + offset * DAY).toISOString().slice(0, 10);
}

/** Run one cell value through the column registry; throw loudly when it does not validate. */
export function parseCell(columnsById, columnId, value, itemName) {
  const column = columnsById.get(columnId);
  if (!column) throw new Error(`Item "${itemName}": unknown column "${columnId}"`);
  const result = columnRegistry.parseValue(column.type, value);
  if (!result.success) {
    throw new Error(`Item "${itemName}", column "${column.title}": ${result.error}`);
  }
  return result.data;
}

/** The raw values of an item description, one entry per filled cell. */
function rawValues(spec, ownerUid, anchor) {
  const values = {};
  const people = [...(spec.owner ? [ownerUid] : []), ...(spec.people ?? []).map(memberUid)];
  if (people.length > 0) {
    values.person = { personsAndTeams: people.map((id) => ({ id, kind: 'person' })) };
  }
  if (spec.status) values.status = { index: STATUS[spec.status] };
  if (spec.priority) values.priority = { index: PRIORITY[spec.priority] };
  if (spec.due !== undefined) values.due = { date: isoDate(anchor, spec.due) };
  if (spec.budget !== undefined) values.budget = spec.budget;
  if (spec.area) values.area = { ids: spec.area.map((a) => AREA[a]) };
  if (spec.next) values.next_step = spec.next;
  if (spec.brief) {
    values.brief = {
      text: spec.brief,
      changed_at: new Date(anchor - spec.created * DAY).toISOString(),
    };
  }
  if (spec.approved === true) values.approved = { checked: 'true' };
  if (spec.link) {
    const [url, text] = spec.link;
    values.link = text ? { url, text } : { url };
  }
  if (spec.rating !== undefined) values.rating = { rating: spec.rating };
  if (spec.vote) values.vote = { votersIds: spec.vote };
  if (spec.color) values.color = { color: { hex: spec.color } };
  if (spec.country)
    values.country = { countryCode: spec.country.code, countryName: spec.country.name };
  if (spec.email) values.contact_email = spec.email;
  if (spec.phone) values.phone = spec.phone;
  if (spec.tags) values.tags = { tag_ids: spec.tags };
  if (spec.timeline)
    values.timeline = {
      from: isoDate(anchor, spec.timeline[0]),
      to: isoDate(anchor, spec.timeline[1]),
    };
  if (spec.week)
    values.week = {
      week: { startDate: isoDate(anchor, spec.week[0]), endDate: isoDate(anchor, spec.week[1]) },
    };
  if (spec.hour) values.hour = spec.hour;
  if (spec.worldClock) values.world_clock = { timezone: spec.worldClock };
  if (spec.location) values.location = spec.location;
  return values;
}

// ---------------------------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------------------------

/**
 * Build every document the seed owns.
 *
 * @param {object} options
 * @param {string} options.workspaceId  Existing workspace the boards go into.
 * @param {string} options.ownerUid     Workspace member who owns the boards and the favourites.
 * @param {string} [options.ownerName]  Display name used on updates and replies.
 * @param {string|null} [options.ownerPhotoUrl]
 * @param {number} [options.anchor]     Midnight UTC the content is laid out around (see `anchorOf`).
 * @returns {{ docs: {path: string, data: object}[], boardIds: string[], summary: object }}
 */
export function buildShowcase({
  workspaceId,
  ownerUid,
  ownerName,
  ownerPhotoUrl = null,
  anchor = anchorOf(),
}) {
  if (!workspaceId) throw new Error('buildShowcase: workspaceId is required');
  if (!ownerUid) throw new Error('buildShowcase: ownerUid is required');

  const ago = (ms) => new ShowcaseTimestamp(anchor - ms);
  const docs = [];
  const summary = {
    boards: {},
    items: 0,
    subitems: 0,
    archived: 0,
    trashed: 0,
    updates: 0,
    replies: 0,
    views: 0,
  };

  const columns = buildColumns();
  const columnsById = new Map(columns.map((c) => [c.id, c]));
  const groups = buildGroups();
  const groupIds = new Set(groups.map((g) => g.id));
  const subitemColumns = defaultSubitemColumns().map((c) => columnDefSchema.parse(c));
  const subitemColumnsById = new Map(subitemColumns.map((c) => [c.id, c]));

  const boardDoc = (overrides) =>
    boardSchema.parse({
      workspaceId,
      folderId: null,
      description: '',
      kind: 'main',
      access: { [ownerUid]: 'owner' },
      accessUids: [ownerUid],
      icon: null,
      subitemColumns: [],
      itemTerminology: 'item',
      state: 'active',
      deletedAt: null,
      createdBy: ownerUid,
      ...overrides,
    });

  // ---- Main board ----
  docs.push({
    path: `boards/${SHOWCASE_MAIN_ID}`,
    data: boardDoc({
      name: '🧪 Atrium Showcase',
      description:
        'Fake data that shows what Atrium can do so far. Generated by scripts/showcase/seed-showcase.mjs: edits here are overwritten when it runs again.',
      position: 'Zz',
      columns,
      subitemColumns,
      columnLocks: ['budget'],
      groups,
      createdAt: ago(30 * DAY),
      updatedAt: ago(2 * HOUR),
    }),
  });

  const positionInGroup = new Map();
  const nextPosition = (groupId) => {
    const n = positionInGroup.get(groupId) ?? 0;
    positionInGroup.set(groupId, n + 1);
    return orderKey(n);
  };

  // Subitems share their parent's group (a rules requirement) and are ordered by position.
  const addSubitems = (parent, parentId, parentCreatedAt) => {
    (SUBITEMS[parent.key] ?? []).forEach((sub, n) => {
      const values = {};
      for (const [columnId, value] of Object.entries(subitemRawValues(sub, ownerUid, anchor))) {
        values[columnId] = parseCell(subitemColumnsById, columnId, value, sub.name);
      }
      docs.push({
        path: `boards/${SHOWCASE_MAIN_ID}/items/${parentId}-sub-${n + 1}`,
        data: itemSchema.parse({
          name: sub.name,
          groupId: parent.group,
          position: orderKey(n),
          parentItemId: parentId,
          values,
          state: 'active',
          deletedAt: null,
          createdAt: parentCreatedAt,
          createdBy: ownerUid,
          updatedAt: ago(Math.max(0.1, Math.min(parent.created - 1, 1 + (n % 3))) * DAY),
          updatedBy: ownerUid,
        }),
      });
      summary.subitems += 1;
    });
  };

  const addItem = (spec, state) => {
    if (!groupIds.has(spec.group))
      throw new Error(`Item "${spec.name}": unknown group "${spec.group}"`);
    const raw = rawValues(spec, ownerUid, anchor);
    const values = {};
    for (const [columnId, value] of Object.entries(raw)) {
      values[columnId] = parseCell(columnsById, columnId, value, spec.name);
    }
    const createdAt = ago(spec.created * DAY);
    const updatedAt =
      state === 'archived'
        ? ago(spec.changed * DAY)
        : state === 'deleted'
          ? ago(spec.deletedDaysAgo * DAY)
          : ago(Math.max(0.1, Math.min(spec.created - 1, 1 + (spec.created % 5))) * DAY);
    const itemId = `showcase-${spec.key}`;
    if (state === 'active') addSubitems(spec, itemId, createdAt);
    docs.push({
      path: `boards/${SHOWCASE_MAIN_ID}/items/${itemId}`,
      data: itemSchema.parse({
        name: spec.name,
        groupId: spec.group,
        position: nextPosition(spec.group),
        parentItemId: null,
        values,
        state,
        deletedAt: state === 'deleted' ? ago(spec.deletedDaysAgo * DAY) : null,
        updatesCount: spec.updates?.length ?? 0,
        ...(spec.description ? { description: descriptionOf(spec.description) } : {}),
        createdAt,
        createdBy: ownerUid,
        updatedAt,
        updatedBy: ownerUid,
      }),
    });
    return itemId;
  };

  const authorFields = {
    authorId: ownerUid,
    ...(ownerName ? { authorName: ownerName } : {}),
    authorPhotoUrl: ownerPhotoUrl,
  };

  for (const spec of ITEMS) {
    const itemId = addItem(spec, 'active');
    summary.items += 1;
    for (const update of spec.updates ?? []) {
      const updateId = `showcase-${update.id}`;
      const replies = update.replies ?? [];
      docs.push({
        path: `boards/${SHOWCASE_MAIN_ID}/items/${itemId}/updates/${updateId}`,
        data: {
          id: updateId,
          ...itemUpdateSchema.parse({
            itemId,
            ...authorFields,
            content: update.content,
            likes: update.likes ? [ownerUid] : [],
            repliesCount: replies.length,
            createdAt: ago(update.ago),
            updatedAt: ago(update.ago),
          }),
        },
      });
      summary.updates += 1;
      for (const reply of replies) {
        const replyId = `showcase-${reply.id}`;
        docs.push({
          path: `boards/${SHOWCASE_MAIN_ID}/items/${itemId}/updates/${updateId}/replies/${replyId}`,
          data: {
            id: replyId,
            ...updateReplySchema.parse({
              updateId,
              ...authorFields,
              content: reply.content,
              likes: [],
              createdAt: ago(reply.ago),
              updatedAt: ago(reply.ago),
            }),
          },
        });
        summary.replies += 1;
      }
    }
  }
  for (const spec of SIDELINED_ITEMS) {
    addItem(spec, spec.state);
    if (spec.state === 'archived') summary.archived += 1;
    else summary.trashed += 1;
  }
  summary.boards[SHOWCASE_MAIN_ID] = {
    items: summary.items + summary.subitems + summary.archived + summary.trashed,
  };

  // ---- Saved views: a shared "Due this week" table (date filter, date sort, two columns hidden) ----
  // `main` is not written: until somebody saves it the app shows it with default settings.
  const isoDay = (offset) => new Date(anchor + offset * DAY).toISOString().slice(0, 10);
  docs.push({
    path: `boards/${SHOWCASE_MAIN_ID}/views/showcase-due-this-week`,
    data: boardViewSchema.parse({
      name: 'Due this week',
      type: 'table',
      position: 'a1',
      ownerId: null,
      settings: {
        filter: {
          personIds: [],
          filterGroup: {
            conjunction: 'and',
            conditions: [
              { columnId: 'due', operator: 'greater_than', value: isoDay(-1) },
              { columnId: 'due', operator: 'less_than', value: isoDay(7) },
            ],
          },
          sortConditions: [{ columnId: 'due', direction: 'asc' }],
          groupByColumnId: null,
        },
        hiddenColumnIds: ['brief', 'next_step'],
      },
      createdAt: ago(5 * DAY),
      createdBy: ownerUid,
      updatedAt: ago(1 * DAY),
      updatedBy: ownerUid,
    }),
  });
  summary.views += 1;

  // ---- A shared Kanban "Status board": lanes from the Status column, three fields on each card ----
  docs.push({
    path: `boards/${SHOWCASE_MAIN_ID}/views/showcase-status-board`,
    data: boardViewSchema.parse({
      name: 'Status board',
      type: 'kanban',
      position: 'a2',
      ownerId: null,
      settings: {
        filter: {
          personIds: [],
          filterGroup: { conjunction: 'and', conditions: [] },
          sortConditions: [],
          groupByColumnId: null,
        },
        hiddenColumnIds: [],
        kanban: {
          columnId: 'status',
          cardColumnIds: ['area', 'due', 'person'],
          collapsedLaneIds: [],
          showEmptyLanes: true,
        },
      },
      createdAt: ago(4 * DAY),
      createdBy: ownerUid,
      updatedAt: ago(1 * DAY),
      updatedBy: ownerUid,
    }),
  });
  summary.views += 1;

  // ---- Two tiny boards so the workspace Archive & Trash page shows something ----
  // (Archived/deleted *items* have no screen yet; that page lists archived and deleted *boards*.)
  const sideBoardColumns = columns
    .filter((c) => ['status', 'due'].includes(c.id))
    .map((c, i) => ({
      ...c,
      position: orderKey(i),
    }));
  const sideBoardGroups = buildGroups([GROUPS[0]]);
  docs.push({
    path: `boards/${SHOWCASE_ARCHIVED_ID}`,
    data: boardDoc({
      name: '🗄️ Showcase: Q2 campaign (archived)',
      description: 'An archived showcase board, for the Archive tab of the Archive & Trash page.',
      position: 'Zy',
      columns: sideBoardColumns,
      groups: sideBoardGroups,
      state: 'archived',
      createdAt: ago(28 * DAY),
      updatedAt: ago(6 * DAY),
    }),
  });
  docs.push({
    path: `boards/${SHOWCASE_TRASHED_ID}`,
    data: boardDoc({
      name: '🗑️ Showcase: Old brainstorm (deleted)',
      description: 'A deleted showcase board, for the Deleted tab of the Archive & Trash page.',
      position: 'Zx',
      columns: sideBoardColumns,
      groups: sideBoardGroups,
      state: 'deleted',
      deletedAt: ago(2 * DAY),
      createdAt: ago(21 * DAY),
      updatedAt: ago(2 * DAY),
    }),
  });
  summary.boards[SHOWCASE_ARCHIVED_ID] = { items: 0 };
  summary.boards[SHOWCASE_TRASHED_ID] = { items: 0 };

  // ---- Fake members' profile docs (members/{uid} only; never roles or memberIds) ----
  for (const member of SHOWCASE_MEMBERS) {
    docs.push({
      path: `workspaces/${workspaceId}/members/${member.uid}`,
      data: workspaceMemberSchema.parse({
        displayName: member.displayName,
        photoURL: null,
        email: member.email,
        role: 'member',
        joinedAt: ago(30 * DAY),
        updatedAt: ago(30 * DAY),
      }),
    });
  }
  summary.members = SHOWCASE_MEMBERS.length;

  // ---- The owner's favourite and recent visit for the main board ----
  docs.push({
    path: `users/${ownerUid}/favorites/${SHOWCASE_MAIN_ID}`,
    data: favoriteSchema.parse({
      boardId: SHOWCASE_MAIN_ID,
      workspaceId,
      addedAt: ago(3 * DAY),
      position: 'Zz',
    }),
  });
  docs.push({
    path: `users/${ownerUid}/recents/${SHOWCASE_MAIN_ID}`,
    data: recentSchema.parse({
      boardId: SHOWCASE_MAIN_ID,
      workspaceId,
      visitedAt: ago(1 * HOUR),
    }),
  });

  // ---- The owner's bell: one notification of each kind, unread and read mixed ----
  // Cloud Functions create these in the app; clients cannot, so the seed script writes them.
  const itemNamed = (key) => {
    const spec = ITEMS.find((i) => i.key === key);
    if (!spec) throw new Error(`Notification: unknown item "${key}"`);
    return { itemId: `showcase-${key}`, itemName: spec.name };
  };
  const person = (key) => SHOWCASE_MEMBERS.find((m) => m.key === key);
  const notification = (kind, actor, itemKey, extra) =>
    docs.push({
      path: `users/${ownerUid}/notifications/${SHOWCASE_NOTIFICATION_PREFIX}${kind}`,
      data: notificationSchema.parse({
        kind,
        actorId: actor.uid,
        actorName: actor.displayName,
        actorPhotoURL: null,
        workspaceId,
        boardId: SHOWCASE_MAIN_ID,
        boardName: '🧪 Atrium Showcase',
        ...itemNamed(itemKey),
        updateId: null,
        replyId: null,
        columnId: null,
        ...extra,
      }),
    });
  notification('mention', person('jordan'), 'hero-copy', {
    updateId: 'showcase-hero-copy-u2',
    snippet: 'Can you double-check the tagline before it goes to the founders?',
    createdAt: ago(20 * 60 * 1000),
    readAt: null,
  });
  notification('reply', person('sam'), 'privacy-policy', {
    updateId: 'showcase-privacy-policy-u1',
    replyId: 'showcase-privacy-policy-u1-r1',
    snippet: 'Counsel confirmed a short summary plus a link to the full cookie table is fine.',
    createdAt: ago(3 * HOUR),
    readAt: ago(2 * HOUR),
  });
  notification('assigned', person('casey'), 'pricing-page', {
    columnId: 'person',
    snippet: '',
    createdAt: ago(1 * DAY),
    readAt: null,
  });
  summary.notifications = SHOWCASE_NOTIFICATION_IDS.length;

  // Positions inside every group must be unique and ascending.
  for (const [groupId, n] of positionInGroup) {
    if (n > DIGITS.length) throw new Error(`Group "${groupId}" has too many items`);
  }

  return { docs, boardIds: [...SHOWCASE_BOARD_IDS], summary };
}

// ---------------------------------------------------------------------------------------------
// The safety allow-list
// ---------------------------------------------------------------------------------------------

/**
 * Whether the seed script may create, update or delete the document at `path`. The only paths it
 * owns are: `boards/showcase-*` and everything below them, the owner's `favorites` and
 * `recents` documents named like a showcase board, the three `showcase-notification-*` notifications, and the fake members' `members` docs in the
 * workspace being seeded. Nothing else, ever.
 */
export function isOwnedPath(path, ownerUid, workspaceId) {
  const parts = path.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return false;
  if (parts[0] === 'boards') {
    return parts.length >= 2 && SHOWCASE_BOARD_IDS.includes(parts[1]);
  }
  if (parts[0] === 'workspaces') {
    // Only the fake members' profile docs, and only in the workspace being seeded.
    return (
      workspaceId !== undefined &&
      parts.length === 4 &&
      parts[1] === workspaceId &&
      parts[2] === 'members' &&
      SHOWCASE_MEMBER_UIDS.includes(parts[3])
    );
  }
  if (parts[0] === 'users') {
    return (
      parts.length === 4 &&
      parts[1] === ownerUid &&
      (((parts[2] === 'favorites' || parts[2] === 'recents') &&
        SHOWCASE_BOARD_IDS.includes(parts[3])) ||
        (parts[2] === 'notifications' && SHOWCASE_NOTIFICATION_IDS.includes(parts[3])))
    );
  }
  return false;
}
