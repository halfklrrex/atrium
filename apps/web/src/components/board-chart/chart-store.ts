import { create } from 'zustand';

/** What each chart view remembers for the session and never saves to the view: whether its settings panel is open. */
interface ChartUiState {
  /** By `boardId:viewId`. */
  settingsOpen: Record<string, boolean>;
  setSettingsOpen: (key: string, open: boolean) => void;
}

export const useChartUi = create<ChartUiState>()((set) => ({
  settingsOpen: {},
  setSettingsOpen: (key, open) =>
    set((s) => ({ settingsOpen: { ...s.settingsOpen, [key]: open } })),
}));
