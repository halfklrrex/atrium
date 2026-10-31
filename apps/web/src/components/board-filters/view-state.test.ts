import {
  defaultCalendarSettings,
  defaultKanbanSettings,
  defaultViewSettings,
  type ViewSettings,
} from '@atrium/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  currentViewState,
  isViewDirty,
  settingsFromState,
  stateFromSettings,
  useFilterStore,
  viewKey,
} from './filter-store';

const store = () => useFilterStore.getState();

const filtered = (): ViewSettings => ({
  ...defaultViewSettings(),
  filter: {
    personIds: ['u1'],
    filterGroup: {
      conjunction: 'and',
      conditions: [{ columnId: 'status', operator: 'is', value: 'Done' }],
    },
    sortConditions: [{ columnId: 'date', direction: 'asc' }],
    groupByColumnId: null,
  },
  hiddenColumnIds: ['notes'],
});

beforeEach(() => {
  useFilterStore.setState({ activeView: {}, views: {} });
});

describe('per-view filter state', () => {
  it('starts a view from its saved settings', () => {
    store().syncView('b1', 'v1', filtered());
    expect(store().getFilterState('b1').personIds).toEqual(['u1']);
    expect(store().getFilterState('b1').sortConditions).toHaveLength(1);
    expect(currentViewState('b1').hiddenColumnIds).toEqual(['notes']);
    expect(isViewDirty(store().views[viewKey('b1', 'v1')])).toBe(false);
  });

  it('starts a view nobody saved yet from the defaults', () => {
    store().syncView('b1', 'main', null);
    expect(store().getFilterState('b1').filterGroup.conditions).toEqual([]);
    expect(currentViewState('b1').hiddenColumnIds).toEqual([]);
  });

  it('keeps every view of a board separate', () => {
    store().syncView('b1', 'main', null);
    store().addCondition('b1', { columnId: 'status', operator: 'is_empty' });
    store().syncView('b1', 'v1', filtered());
    expect(store().getFilterState('b1').filterGroup.conditions[0]?.value).toBe('Done');
    store().syncView('b1', 'main', null);
    expect(store().getFilterState('b1').filterGroup.conditions[0]?.operator).toBe('is_empty');
  });

  it('keeps the same view of two boards separate', () => {
    store().syncView('b1', 'main', null);
    store().syncView('b2', 'main', filtered());
    expect(store().getFilterState('b1').personIds).toEqual([]);
    expect(store().getFilterState('b2').personIds).toEqual(['u1']);
  });

  it('marks a view dirty on any filter, sort, group-by or Hide change, and clean again on revert', () => {
    store().syncView('b1', 'v1', null);
    const dirty = () => isViewDirty(store().views[viewKey('b1', 'v1')]);
    expect(dirty()).toBe(false);
    store().setGroupBy('b1', 'status');
    expect(dirty()).toBe(true);
    store().setGroupBy('b1', null);
    expect(dirty()).toBe(false);
    store().setHiddenColumnIds('b1', ['a']);
    expect(dirty()).toBe(true);
    store().setHiddenColumnIds('b1', []);
    store().togglePersonFilter('b1', 'u9');
    expect(dirty()).toBe(true);
  });

  it('ignores search text for "unsaved"', () => {
    store().syncView('b1', 'v1', null);
    store().setSearchQuery('b1', 'hello');
    expect(isViewDirty(store().views[viewKey('b1', 'v1')])).toBe(false);
  });

  it('discards changes back to the saved settings but keeps the search text', () => {
    store().syncView('b1', 'v1', filtered());
    store().setPersonIds('b1', []);
    store().setHiddenColumnIds('b1', []);
    store().setSearchQuery('b1', 'hello');
    store().discardChanges('b1');
    expect(store().getFilterState('b1').personIds).toEqual(['u1']);
    expect(currentViewState('b1').hiddenColumnIds).toEqual(['notes']);
    expect(store().getFilterState('b1').searchQuery).toBe('hello');
  });

  it('marks the current state saved after a save', () => {
    store().syncView('b1', 'v1', null);
    store().setHiddenColumnIds('b1', ['a', 'b']);
    store().markSaved('b1');
    expect(isViewDirty(store().views[viewKey('b1', 'v1')])).toBe(false);
    store().discardChanges('b1');
    expect(currentViewState('b1').hiddenColumnIds).toEqual(['a', 'b']);
  });

  it('follows the stored settings while untouched, and keeps unsaved changes when they change', () => {
    store().syncView('b1', 'v1', null);
    store().syncView('b1', 'v1', filtered());
    expect(store().getFilterState('b1').personIds).toEqual(['u1']);

    store().setPersonIds('b1', ['u2']);
    store().syncView('b1', 'v1', { ...filtered(), hiddenColumnIds: [] });
    expect(store().getFilterState('b1').personIds).toEqual(['u2']);
    expect(isViewDirty(store().views[viewKey('b1', 'v1')])).toBe(true);
  });

  it('clears filters without touching the hidden columns', () => {
    store().syncView('b1', 'v1', filtered());
    store().resetFilters('b1');
    expect(store().getFilterState('b1').filterGroup.conditions).toEqual([]);
    expect(currentViewState('b1').hiddenColumnIds).toEqual(['notes']);
  });

  it('round-trips settings and never saves the search text', () => {
    const state = stateFromSettings(filtered());
    state.filter.searchQuery = 'secret';
    const saved = settingsFromState(state);
    expect(saved).toEqual(filtered());
    expect(JSON.stringify(saved)).not.toContain('secret');
  });
});

describe('kanban view state', () => {
  const kanbanSettings = (): ViewSettings => ({
    ...defaultViewSettings(),
    kanban: { ...defaultKanbanSettings(), columnId: 'status', cardColumnIds: ['a'] },
  });

  it('starts from the saved kanban settings and stays clean', () => {
    store().syncView('b1', 'k', kanbanSettings());
    expect(currentViewState('b1').kanban?.cardColumnIds).toEqual(['a']);
    expect(isViewDirty(store().views[viewKey('b1', 'k')])).toBe(false);
  });

  it('counts card fields, lane collapsing and the lane column as unsaved changes', () => {
    store().syncView('b1', 'k', kanbanSettings());
    store().setKanban('b1', { cardColumnIds: ['a', 'b'] });
    expect(isViewDirty(store().views[viewKey('b1', 'k')])).toBe(true);
    store().discardChanges('b1');
    expect(currentViewState('b1').kanban?.cardColumnIds).toEqual(['a']);
    store().toggleLane('b1', 'done');
    expect(currentViewState('b1').kanban?.collapsedLaneIds).toEqual(['done']);
    store().toggleLane('b1', 'done');
    expect(currentViewState('b1').kanban?.collapsedLaneIds).toEqual([]);
  });

  it('saves the kanban settings with the rest, and a table never gains them', () => {
    store().syncView('b1', 'k', kanbanSettings());
    store().setKanban('b1', { showEmptyLanes: false });
    const saved = settingsFromState(currentViewState('b1'), kanbanSettings());
    expect(saved.kanban?.showEmptyLanes).toBe(false);
    store().syncView('b1', 'main', null);
    expect(currentViewState('b1').kanban).toBeNull();
    expect(settingsFromState(currentViewState('b1')).kanban).toBeUndefined();
  });
});

describe('calendar and timeline view state', () => {
  const calendarSettings = (): ViewSettings => ({
    ...defaultViewSettings(),
    calendar: { ...defaultCalendarSettings(), columnId: 'due' },
  });

  it('starts from the saved calendar settings and stays clean', () => {
    store().syncView('b1', 'c', calendarSettings());
    expect(currentViewState('b1').calendar?.columnId).toBe('due');
    expect(isViewDirty(store().views[viewKey('b1', 'c')])).toBe(false);
  });

  it('counts calendar and timeline changes as unsaved and discards them', () => {
    store().syncView('b1', 'c', calendarSettings());
    store().setTypeSettings('b1', 'calendar', { mode: 'week' });
    expect(isViewDirty(store().views[viewKey('b1', 'c')])).toBe(true);
    store().discardChanges('b1');
    expect(currentViewState('b1').calendar?.mode).toBe('month');
    store().syncView('b1', 't', null);
    store().setTypeSettings('b1', 'timeline', { zoom: 'days' });
    expect(isViewDirty(store().views[viewKey('b1', 't')])).toBe(true);
    expect(currentViewState('b1').timeline?.showLegend).toBe(true);
  });

  it('saves each type with the rest and never leaks it into another view', () => {
    store().syncView('b1', 'c', calendarSettings());
    store().setTypeSettings('b1', 'calendar', { showWeekends: false });
    const saved = settingsFromState(currentViewState('b1'), calendarSettings());
    expect(saved.calendar?.showWeekends).toBe(false);
    expect(saved.kanban).toBeUndefined();
    store().syncView('b1', 'main', null);
    expect(settingsFromState(currentViewState('b1')).calendar).toBeUndefined();
  });
});
