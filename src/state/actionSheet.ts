import { create } from 'zustand';

import type { SheetConfig } from '@/lib/actionSheet';

/**
 * The action sheet Android is showing, if any.
 *
 * `showActionSheet` is a plain function called from anywhere, and on Android
 * the sheet is a React view mounted once at the root (`ActionSheetHost`), so a
 * store is what connects the two. iOS never writes here; its sheet is the
 * system's.
 */
export interface PresentedSheet {
  /**
   * Each presentation is its own. "Close chat" in one sheet opens a
   * confirmation sheet, and the first one finishing its exit must not clear
   * the second.
   */
  id: number;
  title: string;
  message?: string;
  config: SheetConfig;
}

interface ActionSheetState {
  sheet: PresentedSheet | null;
  present: (sheet: Omit<PresentedSheet, 'id'>) => void;
  /** Clears the sheet once it has left, unless a newer one replaced it. */
  finish: (id: number) => void;
}

let lastId = 0;

export const useActionSheet = create<ActionSheetState>((set, get) => ({
  sheet: null,
  present: (sheet) => {
    lastId += 1;
    set({ sheet: { ...sheet, id: lastId } });
  },
  finish: (id) => {
    if (get().sheet?.id === id) set({ sheet: null });
  },
}));
