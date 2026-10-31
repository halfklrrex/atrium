import { create } from 'zustand';

/**
 * The month or week each calendar view is showing: UI state, kept in memory for the session and
 * never saved to the view (the saved view only remembers mode, column and colours).
 */
interface CalendarUiState {
  /** Any day of the period on screen, by `boardId:viewId`. */
  anchors: Record<string, string>;
  setAnchor: (key: string, day: string) => void;
}

export const useCalendarUi = create<CalendarUiState>()((set) => ({
  anchors: {},
  setAnchor: (key, day) => set((state) => ({ anchors: { ...state.anchors, [key]: day } })),
}));
