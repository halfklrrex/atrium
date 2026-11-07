import { createContext, useContext } from 'react';

/** The z-index popups use inside a modal; `undefined` outside one (the CSS tiers apply). */
const PopupLayerContext = createContext<string | undefined>(undefined);

/** Wrap a modal's content: popovers and cell editors opened inside it draw above the modal. */
export function PopupLayer({ children }: { children: React.ReactNode }) {
  return (
    <PopupLayerContext.Provider value="var(--atrium-z-modal-popup)">
      {children}
    </PopupLayerContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- a hook that belongs with its provider
export function usePopupZIndex(): string | undefined {
  return useContext(PopupLayerContext);
}
