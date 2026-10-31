import {
  defaultCalendarSettings,
  defaultChartSettings,
  defaultKanbanSettings,
  defaultTimelineViewSettings,
  defaultViewSettings,
  uniqueViewName,
  type ViewSettings,
  type ViewType,
} from '@atrium/shared';
import { viewWrites, type BoardViewDoc } from '../../data';
import { positionAfterAll, positionBetween } from '../../lib/positions';
import { showToast } from '../toast-store';
import { newViewOwner } from './view-permissions';

export interface ViewActionCtx {
  boardId: string;
  uid: string;
  canEdit: boolean;
  /** Tabs in order, `main` first. */
  views: readonly BoardViewDoc[];
  /** Go to a view's URL. */
  goTo: (viewId: string, options?: { replace?: boolean }) => void;
}

const fail = (what: string, error: unknown): void => {
  console.warn(what, error);
  showToast(`${what} Check your connection and try again.`, { type: 'negative' });
};

const LABELS: Record<ViewType, string> = {
  table: 'Table',
  kanban: 'Kanban',
  calendar: 'Calendar',
  timeline: 'Timeline',
  chart: 'Chart',
};

/** The settings a new view of a type starts with. */
function newViewSettings(type: ViewType): ViewSettings {
  const base = defaultViewSettings();
  switch (type) {
    case 'table':
      return base;
    case 'kanban':
      return { ...base, kanban: defaultKanbanSettings() };
    case 'calendar':
      return { ...base, calendar: defaultCalendarSettings() };
    case 'timeline':
      return { ...base, timeline: defaultTimelineViewSettings() };
    case 'chart':
      return { ...base, chart: defaultChartSettings() };
    default: {
      const never: never = type;
      return never;
    }
  }
}

/** A key right after `view` (between it and the next tab). */
function positionAfter(views: readonly BoardViewDoc[], view: BoardViewDoc): string {
  const index = views.findIndex((v) => v.id === view.id);
  const next = views[index + 1];
  return positionBetween(
    view.position,
    next && next.position > view.position ? next.position : null,
  );
}

export const viewActions = {
  /** "+ Add view": a new view named after its type, last in the row, opened at once. */
  async add(ctx: ViewActionCtx, type: ViewType): Promise<void> {
    try {
      const id = await viewWrites.create(ctx.boardId, ctx.uid, {
        type,
        name: uniqueViewName(
          LABELS[type],
          ctx.views.map((v) => v.name),
        ),
        ownerId: newViewOwner(ctx.uid, ctx.canEdit),
        position: positionAfterAll(ctx.views.filter((v) => v.id !== 'main')),
        settings: newViewSettings(type),
      });
      ctx.goTo(id);
    } catch (error) {
      fail('Could not add the view.', error);
    }
  },

  async rename(ctx: ViewActionCtx, view: BoardViewDoc, name: string): Promise<void> {
    const next = name.trim().slice(0, 60);
    if (!next || next === view.name) return;
    try {
      await viewWrites.rename(ctx.boardId, ctx.uid, view.id, next);
    } catch (error) {
      fail('Could not rename the view.', error);
    }
  },

  /** A copy right after the original, with the same settings. Personal stays personal. */
  async duplicate(ctx: ViewActionCtx, view: BoardViewDoc, settings?: ViewSettings): Promise<void> {
    try {
      const id = await viewWrites.create(ctx.boardId, ctx.uid, {
        type: view.type,
        name: uniqueViewName(
          `${view.name} copy`.slice(0, 60),
          ctx.views.map((v) => v.name),
        ),
        ownerId: view.ownerId === null ? newViewOwner(ctx.uid, ctx.canEdit) : ctx.uid,
        position: positionAfter(ctx.views, view),
        settings: settings ?? view.settings,
      });
      ctx.goTo(id);
    } catch (error) {
      fail('Could not duplicate the view.', error);
    }
  },

  /** Shared to personal or back. The copy replaces the original, so the app moves to the copy. */
  async changeScope(ctx: ViewActionCtx, view: BoardViewDoc, personal: boolean): Promise<void> {
    try {
      const id = await viewWrites.changeScope(
        ctx.boardId,
        ctx.uid,
        view,
        personal ? ctx.uid : null,
      );
      ctx.goTo(id, { replace: true });
      showToast(
        personal
          ? 'Only you can see this view now.'
          : 'Everyone on the board can see this view now.',
      );
    } catch (error) {
      fail('Could not change who sees the view.', error);
    }
  },

  /** Delete with an "Undo" toast that puts the same view back. */
  async remove(ctx: ViewActionCtx, view: BoardViewDoc, current: boolean): Promise<void> {
    try {
      await viewWrites.remove(ctx.boardId, view.id);
      if (current) ctx.goTo('main', { replace: true });
      showToast(`Deleted "${view.name}".`, {
        action: {
          label: 'Undo',
          onClick: () => {
            viewWrites.restore(ctx.boardId, ctx.uid, view).then(
              () => ctx.goTo(view.id),
              (error: unknown) => fail('Could not restore the view.', error),
            );
          },
        },
      });
    } catch (error) {
      fail('Could not delete the view.', error);
    }
  },

  /** Drag the tab `view` so it ends up at `index` among the tabs after `main`. */
  async move(ctx: ViewActionCtx, view: BoardViewDoc, index: number): Promise<void> {
    const others = ctx.views.filter((v) => v.id !== view.id && v.id !== 'main');
    const clamped = Math.max(0, Math.min(index, others.length));
    const position = positionBetween(
      others[clamped - 1]?.position ?? null,
      others[clamped]?.position ?? null,
    );
    try {
      await viewWrites.reorder(ctx.boardId, ctx.uid, view.id, position);
    } catch (error) {
      fail('Could not move the view.', error);
    }
  },
};
