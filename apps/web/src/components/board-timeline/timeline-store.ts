import { create } from 'zustand';

/** Where a timeline view was scrolled to (in the scroller's own pixels). */
export interface TimelineScroll {
  left: number;
  top: number;
}

/**
 * What each timeline view remembers for the session and never saves to the view: its scroll
 * position, whether the lane-name pane is hidden and whether the settings panel is open.
 */
interface TimelineUiState {
  /** By `boardId:viewId`. */
  scroll: Record<string, TimelineScroll>;
  paneHidden: Record<string, boolean>;
  settingsOpen: Record<string, boolean>;
  setScroll: (key: string, scroll: TimelineScroll) => void;
  setPaneHidden: (key: string, hidden: boolean) => void;
  setSettingsOpen: (key: string, open: boolean) => void;
}

export const useTimelineUi = create<TimelineUiState>()((set) => ({
  scroll: {},
  paneHidden: {},
  settingsOpen: {},
  setScroll: (key, scroll) => set((s) => ({ scroll: { ...s.scroll, [key]: scroll } })),
  setPaneHidden: (key, hidden) => set((s) => ({ paneHidden: { ...s.paneHidden, [key]: hidden } })),
  setSettingsOpen: (key, open) =>
    set((s) => ({ settingsOpen: { ...s.settingsOpen, [key]: open } })),
}));
