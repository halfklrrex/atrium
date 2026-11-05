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
