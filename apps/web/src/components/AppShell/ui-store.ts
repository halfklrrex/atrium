import type { BoardKind } from '@atrium/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** The one modal dialog that may be open at a time, rendered by `DialogHost`. */
export type DialogState =
  | { type: 'newWorkspace' }
  | { type: 'workspaceSettings'; workspaceId: string }
  | { type: 'newBoard'; workspaceId: string; folderId: string | null; kind?: BoardKind }
  | {
      type: 'folder';
      workspaceId: string;
      /** Set to rename/recolour an existing folder. */
      folderId?: string;
      /** Set to create a sub-folder. */
      parentFolderId?: string | null;
    }
  | { type: 'deleteFolder'; workspaceId: string; folderId: string }
  | { type: 'shareBoard'; boardId: string }
  | { type: 'members'; workspaceId: string; tab?: 'members' | 'invites' }
  | { type: 'notificationSettings' }
  | { type: 'search'; initialTerm?: string }
  | { type: 'about' };

interface UiState {
  /** Off-canvas sidebar on narrow screens; ignored on desktop. */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  /** Desktop sidebar collapsed to zero width (remembered between visits). */
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** Right-hand notifications panel (the bell inbox). */
  notificationsOpen: boolean;
  setNotificationsOpen: (open: boolean) => void;
  dialog: DialogState | null;
  openDialog: (dialog: DialogState) => void;
  closeDialog: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: false,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      sidebarCollapsed: false,
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      notificationsOpen: false,
      setNotificationsOpen: (notificationsOpen) => set({ notificationsOpen }),
      dialog: null,
      openDialog: (dialog) => set({ dialog }),
      closeDialog: () => set({ dialog: null }),
    }),
    {
      name: 'atrium.ui',
      version: 1,
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);
