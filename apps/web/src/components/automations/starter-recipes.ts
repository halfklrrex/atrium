import { columnRegistry, type ColumnDef, type GroupDef } from '@atrium/shared';
import type { AutomationInput } from '../../data/automations';

/** A one-click preset that opens the recipe builder prefilled. */
export interface StarterRecipe {
  id: 'status-to-group' | 'item-created-notify' | 'button-sets-status';
  title: string;
  description: string;
  input: AutomationInput;
}

/** What the presets need from the board. */
export interface StarterBoard {
  columns: readonly Pick<ColumnDef, 'id' | 'type' | 'title' | 'settings'>[];
  groups: readonly Pick<GroupDef, 'id' | 'title'>[];
}

interface Label {
  index: number;
  label: string;
  isDone?: boolean;
}

function statusLabels(column: Pick<ColumnDef, 'type' | 'settings'>): Label[] {
  if (!columnRegistry.has(column.type)) return [];
  const parsed = columnRegistry.parseSettings(column.type, column.settings);
  const labels = parsed.success ? (parsed.data as { labels?: Label[] }).labels : undefined;
  return labels ?? [];
}

/** The label that means "done": the one flagged `isDone`, else one called Done, else the last. */
function doneLabel(labels: readonly Label[]): Label | null {
  return (
    labels.find((l) => l.isDone) ??
    labels.find((l) => l.label.trim().toLowerCase() === 'done') ??
    labels.at(-1) ??
    null
  );
}

/** The group a finished item belongs in: one named like "Done", else the last group. */
function doneGroup<G extends Pick<GroupDef, 'id' | 'title'>>(groups: readonly G[]): G | null {
  return (
    groups.find((g) => /\b(done|complete|completed|finished)\b/i.test(g.title)) ??
    groups.at(-1) ??
    null
  );
}

/**
 * The three starter recipes, built against the board's own columns and groups. A preset is left out
 * when the board has no column or group it fits; `uid` is the person who gets the notification.
 */
export function buildStarterRecipes(board: StarterBoard, uid: string): StarterRecipe[] {
  const status = board.columns.find((c) => c.type === 'status');
  const done = status ? doneLabel(statusLabels(status)) : null;
  const button = board.columns.find((c) => c.type === 'button');
  const group = doneGroup(board.groups);
  const starters: StarterRecipe[] = [];

  if (status && done && group) {
    starters.push({
      id: 'status-to-group',
      title: `When ${status.title} changes to ${done.label}, move the item to a group`,
      description: `Moves finished items to ${group.title}.`,
      input: {
        name: '',
        trigger: { type: 'status_changed', columnId: status.id, toLabelId: done.index },
        conditions: [],
        actions: [{ type: 'move_to_group', groupId: group.id }],
      },
    });
  }

  if (uid) {
    starters.push({
      id: 'item-created-notify',
      title: 'When an item is created, notify the board owner',
      description: 'You get a notification for every new item.',
      input: {
        name: '',
        trigger: { type: 'item_created' },
        conditions: [],
        actions: [{ type: 'notify', uids: [uid] }],
      },
    });
  }

  if (button && status && done) {
    starters.push({
      id: 'button-sets-status',
      title: `When ${button.title} is clicked, set ${status.title}`,
      description: `Sets ${status.title} to ${done.label}.`,
      input: {
        name: '',
        trigger: { type: 'button_clicked', columnId: button.id },
        conditions: [],
        actions: [{ type: 'set_value', columnId: status.id, value: { index: done.index } }],
      },
    });
  }

  return starters;
}

// ---------------------------------------------------------------------------------------------
// Template catalog (P5e). The Create tab browses these; only `ready` ones can make a recipe.
// ---------------------------------------------------------------------------------------------

export const TEMPLATE_CATEGORIES = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'communication', label: 'Communication' },
  { id: 'dates', label: 'Dates & deadlines' },
  { id: 'connected', label: 'Connected & mirror columns' },
  { id: 'sync', label: 'Integrations' },
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]['id'];

/**
 * `ready` works on today's engine. The rest are shown but cannot be used: `p5c` needs triggers
 * and actions that are not built yet, `p5d` needs time-based triggers, `p9` needs integrations.
 */
export type TemplateAvailability = 'ready' | 'p5c' | 'p5d' | 'p9';

export const AVAILABILITY_LABELS: Record<TemplateAvailability, string> = {
  ready: 'Ready',
  p5c: 'Soon · P5c',
  p5d: 'Planned · P5d',
  p9: 'Planned · P9',
};

export interface CatalogTemplate {
  id: string;
  /** The sentence; the words between asterisks are the ones the person fills in (shown bold). */
  sentence: string;
  /** Where it lives in the sidebar. Recommended templates also show under Recommended. */
  category: Exclude<TemplateCategory, 'recommended'>;
  recommended: boolean;
  availability: TemplateAvailability;
  /** Present exactly on `ready` templates: the prefilled recipe, or null if the board does not fit. */
  build?: (board: StarterBoard, uid: string) => AutomationInput | null;
}

const labelMatching = (labels: readonly Label[], pattern: RegExp) =>
  labels.find((l) => pattern.test(l.label));

const draftOf = (
  trigger: AutomationInput['trigger'],
  actions: AutomationInput['actions'],
  conditions: AutomationInput['conditions'] = [],
): AutomationInput => ({ name: '', trigger, conditions, actions });

function firstStatus(board: StarterBoard) {
  const column = board.columns.find((c) => c.type === 'status');
  if (!column) return null;
  const labels = statusLabels(column);
  const done = doneLabel(labels);
  return { column, labels, done };
}

const notifyActions = (uid: string): AutomationInput['actions'] | null =>
  uid ? [{ type: 'notify', uids: [uid] }] : null;

type Category = CatalogTemplate['category'];

const ready = (
  id: string,
  sentence: string,
  category: Category,
  recommended: boolean,
  build: NonNullable<CatalogTemplate['build']>,
): CatalogTemplate => ({ id, sentence, category, recommended, availability: 'ready', build });

const planned = (
  id: string,
  sentence: string,
  category: Category,
  recommended: boolean,
  availability: Exclude<TemplateAvailability, 'ready'>,
): CatalogTemplate => ({ id, sentence, category, recommended, availability });

export const TEMPLATE_CATALOG: readonly CatalogTemplate[] = [
  ready(
    'item-created-notify',
    'When an *item is created* notify *someone*',
    'communication',
    true,
    (_board, uid) => {
      const actions = notifyActions(uid);
      return actions ? draftOf({ type: 'item_created' }, actions) : null;
    },
  ),
  ready(
    'status-to-group',
    'When *status* changes to *Done* move the item to *a group*',
    'productivity',
    true,
    (board) => {
      const status = firstStatus(board);
      const group = doneGroup(board.groups);
      if (!status?.done || !group) return null;
      return draftOf(
        { type: 'status_changed', columnId: status.column.id, toLabelId: status.done.index },
        [{ type: 'move_to_group', groupId: group.id }],
      );
    },
  ),
  planned('date-arrives-notify', 'When a *date* arrives notify *someone*', 'dates', false, 'p5d'),
  ready(
    'status-notify',
    'When *status* changes to *Done* notify *someone*',
    'communication',
    true,
    (board, uid) => {
      const status = firstStatus(board);
      const actions = notifyActions(uid);
      if (!status?.done || !actions) return null;
      return draftOf(
        { type: 'status_changed', columnId: status.column.id, toLabelId: status.done.index },
        actions,
      );
    },
  ),
  ready(
    'button-sets-status',
    'When *a button* is clicked set *status* to *Done*',
    'productivity',
    true,
    (board) => {
      const status = firstStatus(board);
      const button = board.columns.find((c) => c.type === 'button');
      if (!status?.done || !button) return null;
      return draftOf({ type: 'button_clicked', columnId: button.id }, [
        { type: 'set_value', columnId: status.column.id, value: { index: status.done.index } },
      ]);
    },
  ),
  ready(
    'stuck-and-high-notify',
    'When *status* changes to *Stuck* and *priority* is *High* notify *someone*',
    'communication',
    true,
    (board, uid) => {
      const [first, second] = board.columns.filter((c) => c.type === 'status');
      const stuck = first ? labelMatching(statusLabels(first), /\b(stuck|blocked)\b/i) : undefined;
      const high = second
        ? labelMatching(statusLabels(second), /\b(high|urgent|critical)\b/i)
        : undefined;
      const actions = notifyActions(uid);
      if (!first || !second || !stuck || !high || !actions) return null;
      return draftOf(
        { type: 'status_changed', columnId: first.id, toLabelId: stuck.index },
        actions,
        [{ columnId: second.id, op: 'is', value: { index: high.index } }],
      );
    },
  ),
  ready(
    'created-sets-status',
    'When an *item is created* set *status* to *its first label*',
    'productivity',
    true,
    (board) => {
      const status = firstStatus(board);
      const first = status?.labels[0];
      if (!status || !first) return null;
      return draftOf({ type: 'item_created' }, [
        { type: 'set_value', columnId: status.column.id, value: { index: first.index } },
      ]);
    },
  ),
  ready(
    'done-archives',
    'When *status* changes to *Done* archive the item',
    'productivity',
    false,
    (board) => {
      const status = firstStatus(board);
      if (!status?.done) return null;
      return draftOf(
        { type: 'status_changed', columnId: status.column.id, toLabelId: status.done.index },
        [{ type: 'archive_item' }],
      );
    },
  ),
  ready(
    'button-moves-group',
    'When *a button* is clicked move the item to *a group*',
    'productivity',
    false,
    (board) => {
      const button = board.columns.find((c) => c.type === 'button');
      const group = doneGroup(board.groups);
      if (!button || !group) return null;
      return draftOf({ type: 'button_clicked', columnId: button.id }, [
        { type: 'move_to_group', groupId: group.id },
      ]);
    },
  ),
  ready(
    'created-renames',
    'When an *item is created* rename it to *a pattern*',
    'productivity',
    false,
    () => draftOf({ type: 'item_created' }, [{ type: 'rename_item', template: '{date} {name}' }]),
  ),
  planned(
    'creator-becomes-owner',
    'When an item is created assign *the creator* as *owner*',
    'productivity',
    true,
    'p5c',
  ),
  ready(
    'group-move-sets-status',
    'When an item moves to *a group* set *status* to *something*',
    'productivity',
    true,
    (board) => {
      const status = firstStatus(board);
      const group = doneGroup(board.groups);
      if (!status?.done || !group) return null;
      return draftOf({ type: 'item_moved', groupId: group.id }, [
        { type: 'set_value', columnId: status.column.id, value: { index: status.done.index } },
      ]);
    },
  ),
  ready(
    'person-assigned-notify',
    'When *a person* is assigned notify *someone*',
    'communication',
    false,
    (board, uid) => {
      const people = board.columns.find((c) => c.type === 'people');
      const actions = notifyActions(uid);
      if (!people || !actions) return null;
      return draftOf({ type: 'person_assigned', columnId: people.id }, actions);
    },
  ),
  ready(
    'status-creates-item',
    'When *status* changes to *something* create an item in *a group*',
    'productivity',
    false,
    (board) => {
      const status = firstStatus(board);
      const group = board.groups[0];
      if (!status?.done || !group) return null;
      return draftOf(
        { type: 'status_changed', columnId: status.column.id, toLabelId: status.done.index },
        [{ type: 'create_item', name: 'Follow-up: {name}', groupId: group.id }],
      );
    },
  ),
  ready(
    'stuck-posts-update',
    'When *status* changes to *Stuck* post *an update*',
    'communication',
    false,
    (board) => {
      const column = board.columns.find((c) => c.type === 'status');
      const stuck = column
        ? labelMatching(statusLabels(column), /\b(stuck|blocked)\b/i)
        : undefined;
      if (!column || !stuck) return null;
      return draftOf({ type: 'status_changed', columnId: column.id, toLabelId: stuck.index }, [
        { type: 'post_update', text: '{name} is stuck. Can someone help unblock it?' },
      ]);
    },
  ),
  planned(
    'weekly-create-item',
    'Every *Monday* create an item in *a group*',
    'dates',
    false,
    'p5d',
  ),
  planned(
    'overdue-notify',
    'When a *date* has passed and *status* is not *Done* notify *someone*',
    'dates',
    true,
    'p5d',
  ),
  planned(
    'connected-status-notify',
    'When a *connected item* changes status notify *someone*',
    'connected',
    false,
    'p5c',
  ),
  planned('created-sends-email', 'When an item is created send *an email*', 'sync', false, 'p9'),
  planned(
    'status-adds-event',
    'When *status* changes add an event to *a calendar*',
    'sync',
    false,
    'p9',
  ),
];

/** Templates of one sidebar category; `recommended` gathers every template flagged as such. */
export function templatesByCategory(
  category: TemplateCategory,
  catalog: readonly CatalogTemplate[] = TEMPLATE_CATALOG,
): CatalogTemplate[] {
  return category === 'recommended'
    ? catalog.filter((t) => t.recommended)
    : catalog.filter((t) => t.category === category);
}

export function templatesByAvailability(
  availability: TemplateAvailability,
  catalog: readonly CatalogTemplate[] = TEMPLATE_CATALOG,
): CatalogTemplate[] {
  return catalog.filter((t) => t.availability === availability);
}

/** The recipe a `ready` template makes on this board, or null when it is not ready or the board lacks what it needs. */
export function buildTemplateInput(
  template: CatalogTemplate,
  board: StarterBoard,
  uid: string,
): AutomationInput | null {
  return template.availability === 'ready' && template.build ? template.build(board, uid) : null;
}

/** The sentence without its emphasis marks, for labels and search. */
export const plainSentence = (template: Pick<CatalogTemplate, 'sentence'>): string =>
  template.sentence.replaceAll('*', '');
