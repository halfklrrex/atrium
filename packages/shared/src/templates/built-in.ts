import { columnRegistry } from '../columns';
import { DEFAULT_PRIORITY_LABELS } from '../columns';
import type { StatusLabel } from '../columns';
import type { ColumnDef, GroupDef } from '../schemas/board';
import type { TemplateSampleItem, TemplateStructure } from '../schemas/template';

/** A template that ships with Atrium (code, not data). Saved templates live in Firestore. */
export interface BuiltInTemplate {
  /** Stable slug, e.g. `project-tracker`. */
  id: string;
  name: string;
  description: string;
  /** Icon key the gallery maps to a Vibe icon (`project`, `calendar`, `bug`, `home`, `book`). */
  icon: string;
  structure: TemplateStructure;
  sampleItems: TemplateSampleItem[];
}

const GREY = '#c4c4c4';
const ORANGE = '#fdab3d';
const GREEN = '#00c875';
const RED = '#df2f4a';
const BLUE = '#579bfc';
const PURPLE = '#a25ddc';
const YELLOW = '#ffcb00';

type StatusEntry = readonly [id: string, label: string, color: string, isDone?: boolean];

/** Status labels with sequential indexes starting at 0. */
function statusLabels(entries: readonly StatusEntry[]): { labels: StatusLabel[] } {
  return {
    labels: entries.map(([id, label, color, isDone], index) => ({
      id,
      index,
      label,
      color,
      ...(isDone ? { isDone: true } : {}),
    })),
  };
}

function dropdownLabels(names: readonly string[]): {
  labels: { id: number; label: string }[];
  limitSelect: boolean;
} {
  return { labels: names.map((label, id) => ({ id, label })), limitSelect: false };
}

function column(
  id: string,
  type: string,
  title: string,
  position: number,
  settings?: Record<string, unknown>,
): ColumnDef {
  return {
    id,
    type,
    title,
    position: `a${position}`,
    settings: settings ?? (columnRegistry.defaultSettings(type) as Record<string, unknown>),
  };
}

function groups(entries: readonly [id: string, title: string, color: string][]): GroupDef[] {
  return entries.map(([id, title, color], i) => ({ id, title, color, position: `a${i}` }));
}

const status = (index: number) => ({ index });
const text = (value: string) => ({ text: value });

const PROJECT_TRACKER: BuiltInTemplate = {
  id: 'project-tracker',
  name: 'Project tracker',
  description: 'Plan work, assign owners and follow every task from to do to done.',
  icon: 'project',
  structure: {
    columns: [
      column('owner', 'people', 'Owner', 0),
      column(
        'status',
        'status',
        'Status',
        1,
        statusLabels([
          ['working_orange', 'Working on it', ORANGE],
          ['done_green', 'Done', GREEN, true],
          ['stuck_red', 'Stuck', RED],
        ]),
      ),
      column('priority', 'status', 'Priority', 2, {
        labels: DEFAULT_PRIORITY_LABELS.map((l) => ({ ...l })),
      }),
      column('due', 'date', 'Due date', 3),
      column('notes', 'long_text', 'Notes', 4),
    ],
    subitemColumns: [],
    groups: groups([
      ['to_do', 'To do', BLUE],
      ['in_progress', 'In progress', ORANGE],
      ['done', 'Done', GREEN],
    ]),
    itemTerminology: 'task',
  },
  sampleItems: [
    {
      name: 'Define the goal and scope',
      groupId: 'done',
      values: { status: status(1), priority: status(0) },
    },
    {
      name: 'Draft the plan',
      groupId: 'in_progress',
      values: {
        status: status(0),
        priority: status(1),
        notes: text('List the milestones and who owns each one.'),
      },
    },
    {
      name: 'Gather what we need',
      groupId: 'in_progress',
      values: { status: status(2), priority: status(2) },
    },
    { name: 'Kick-off meeting', groupId: 'to_do', values: { priority: status(1) } },
    { name: 'First review', groupId: 'to_do', values: { priority: status(2) } },
    { name: 'Wrap up and share results', groupId: 'to_do', values: { priority: status(3) } },
  ],
};

const CONTENT_CALENDAR: BuiltInTemplate = {
  id: 'content-calendar',
  name: 'Content calendar',
  description: 'Keep ideas, drafts and published posts in one place, by channel.',
  icon: 'calendar',
  structure: {
    columns: [
      column('author', 'people', 'Author', 0),
      column(
        'status',
        'status',
        'Status',
        1,
        statusLabels([
          ['idea_blue', 'Idea', BLUE],
          ['drafting_orange', 'Drafting', ORANGE],
          ['in_review_purple', 'In review', PURPLE],
          ['scheduled_yellow', 'Scheduled', YELLOW],
          ['published_green', 'Published', GREEN, true],
        ]),
      ),
      column(
        'channel',
        'dropdown',
        'Channel',
        2,
        dropdownLabels(['Blog', 'Newsletter', 'Instagram', 'YouTube']),
      ),
      column('publish_date', 'date', 'Publish date', 3),
      column('link', 'link', 'Link', 4),
    ],
    subitemColumns: [],
    groups: groups([
      ['ideas', 'Ideas', BLUE],
      ['in_production', 'In production', ORANGE],
      ['published', 'Published', GREEN],
    ]),
    itemTerminology: 'post',
  },
  sampleItems: [
    {
      name: 'Behind the scenes of our process',
      groupId: 'ideas',
      values: { status: status(0), channel: { ids: [2] } },
    },
    {
      name: 'Five lessons from this year',
      groupId: 'ideas',
      values: { status: status(0), channel: { ids: [0, 1] } },
    },
    {
      name: 'Product walkthrough video',
      groupId: 'in_production',
      values: { status: status(1), channel: { ids: [3] } },
    },
    {
      name: 'Monthly newsletter',
      groupId: 'in_production',
      values: { status: status(2), channel: { ids: [1] } },
    },
    {
      name: 'Launch announcement',
      groupId: 'published',
      values: {
        status: status(4),
        channel: { ids: [0] },
        link: { url: 'https://example.com/launch', text: 'Launch post' },
      },
    },
  ],
};

const BUG_TRACKER: BuiltInTemplate = {
  id: 'bug-tracker',
  name: 'Bug tracker',
  description: 'Log bugs with severity and steps to reproduce, then track them to a fix.',
  icon: 'bug',
  structure: {
    columns: [
      column('assignee', 'people', 'Assignee', 0),
      column(
        'status',
        'status',
        'Status',
        1,
        statusLabels([
          ['open_red', 'Open', RED],
          ['in_progress_orange', 'In progress', ORANGE],
          ['fixed_green', 'Fixed', GREEN, true],
          ['wont_fix_grey', 'Will not fix', GREY, true],
        ]),
      ),
      column(
        'severity',
        'status',
        'Severity',
        2,
        statusLabels([
          ['blocker_red', 'Blocker', RED],
          ['major_orange', 'Major', ORANGE],
          ['minor_blue', 'Minor', BLUE],
          ['trivial_grey', 'Trivial', GREY],
        ]),
      ),
      column(
        'component',
        'dropdown',
        'Component',
        3,
        dropdownLabels(['Frontend', 'Backend', 'Mobile', 'Docs']),
      ),
      column('steps', 'long_text', 'Steps to reproduce', 4),
      column('report', 'link', 'Report link', 5),
    ],
    subitemColumns: [],
    groups: groups([
      ['open', 'Open bugs', RED],
      ['fixed', 'Fixed', GREEN],
    ]),
    itemTerminology: 'bug',
  },
  sampleItems: [
    {
      name: 'Login button does nothing on first click',
      groupId: 'open',
      values: {
        status: status(0),
        severity: status(0),
        component: { ids: [0] },
        steps: text('1. Open the page. 2. Click Log in once.'),
      },
    },
    {
      name: 'Totals are off by one after export',
      groupId: 'open',
      values: { status: status(1), severity: status(1), component: { ids: [1] } },
    },
    {
      name: 'Typo in the onboarding screen',
      groupId: 'open',
      values: { status: status(0), severity: status(3), component: { ids: [3] } },
    },
    {
      name: 'App crashes when rotating the phone',
      groupId: 'open',
      values: { status: status(0), severity: status(1), component: { ids: [2] } },
    },
    {
      name: 'Dark mode flicker on load',
      groupId: 'fixed',
      values: { status: status(2), severity: status(2), component: { ids: [0] } },
    },
  ],
};

const FAMILY_CHORES: BuiltInTemplate = {
  id: 'family-chores',
  name: 'Family chores',
  description: 'Share the household jobs, see who has what and tick them off.',
  icon: 'home',
  structure: {
    columns: [
      column('who', 'people', 'Who', 0),
      column(
        'status',
        'status',
        'Status',
        1,
        statusLabels([
          ['to_do_grey', 'To do', GREY],
          ['doing_orange', 'Doing it', ORANGE],
          ['done_green', 'Done', GREEN, true],
        ]),
      ),
      column(
        'frequency',
        'dropdown',
        'How often',
        2,
        dropdownLabels(['Daily', 'Weekly', 'Monthly']),
      ),
      column('points', 'numbers', 'Points', 3),
      column('done', 'checkbox', 'Checked off', 4),
    ],
    subitemColumns: [],
    groups: groups([
      ['daily', 'Every day', BLUE],
      ['weekly', 'Every week', PURPLE],
      ['monthly', 'Every month', YELLOW],
    ]),
    itemTerminology: 'chore',
  },
  sampleItems: [
    {
      name: 'Make the beds',
      groupId: 'daily',
      values: {
        status: status(2),
        frequency: { ids: [0] },
        points: 1,
        done: { checked: 'true' },
      },
    },
    {
      name: 'Wash the dishes',
      groupId: 'daily',
      values: { status: status(1), frequency: { ids: [0] }, points: 2 },
    },
    {
      name: 'Take out the bins',
      groupId: 'weekly',
      values: { status: status(0), frequency: { ids: [1] }, points: 2 },
    },
    {
      name: 'Vacuum the living room',
      groupId: 'weekly',
      values: { status: status(0), frequency: { ids: [1] }, points: 3 },
    },
    {
      name: 'Clean the fridge',
      groupId: 'monthly',
      values: { status: status(0), frequency: { ids: [2] }, points: 5 },
    },
    {
      name: 'Wash the windows',
      groupId: 'monthly',
      values: { status: status(0), frequency: { ids: [2] }, points: 5 },
    },
  ],
};

const READING_LIST: BuiltInTemplate = {
  id: 'reading-list',
  name: 'Reading list',
  description: 'Track the books you want to read, are reading and have finished, with ratings.',
  icon: 'book',
  structure: {
    columns: [
      column('author', 'text', 'Author', 0),
      column(
        'status',
        'status',
        'Status',
        1,
        statusLabels([
          ['want_grey', 'Want to read', GREY],
          ['reading_orange', 'Reading', ORANGE],
          ['finished_green', 'Finished', GREEN, true],
        ]),
      ),
      column(
        'genre',
        'dropdown',
        'Genre',
        2,
        dropdownLabels(['Fiction', 'Non-fiction', 'Fantasy', 'Mystery', 'Biography']),
      ),
      column('rating', 'rating', 'Rating', 3),
      column('link', 'link', 'Link', 4),
    ],
    subitemColumns: [],
    groups: groups([
      ['up_next', 'Up next', BLUE],
      ['reading_now', 'Reading now', ORANGE],
      ['finished', 'Finished', GREEN],
    ]),
    itemTerminology: 'book',
  },
  sampleItems: [
    {
      name: 'The Pragmatic Programmer',
      groupId: 'up_next',
      values: { author: 'Andrew Hunt and David Thomas', status: status(0), genre: { ids: [1] } },
    },
    {
      name: 'The Hobbit',
      groupId: 'up_next',
      values: { author: 'J. R. R. Tolkien', status: status(0), genre: { ids: [2] } },
    },
    {
      name: 'Educated',
      groupId: 'reading_now',
      values: { author: 'Tara Westover', status: status(1), genre: { ids: [4] } },
    },
    {
      name: 'Gone Girl',
      groupId: 'finished',
      values: {
        author: 'Gillian Flynn',
        status: status(2),
        genre: { ids: [3] },
        rating: { rating: 4 },
      },
    },
    {
      name: 'Project Hail Mary',
      groupId: 'finished',
      values: {
        author: 'Andy Weir',
        status: status(2),
        genre: { ids: [0] },
        rating: { rating: 5 },
        link: { url: 'https://example.com/hail-mary' },
      },
    },
  ],
};

export const BUILT_IN_TEMPLATES: readonly BuiltInTemplate[] = [
  PROJECT_TRACKER,
  CONTENT_CALENDAR,
  BUG_TRACKER,
  FAMILY_CHORES,
  READING_LIST,
];

export function builtInTemplate(id: string): BuiltInTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id);
}
