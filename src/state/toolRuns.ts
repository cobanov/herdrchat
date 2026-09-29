import { create } from 'zustand';

/**
 * Which tool runs and calls are open, by their thread key.
 *
 * Kept outside the rows because FlashList recycles them: state held in a row
 * would open whatever run next scrolled into that view. Only what someone
 * tapped is stored; everything else follows the tool-calls switch.
 */
interface ToolRunsState {
  open: Readonly<Record<string, boolean>>;
  toggle: (key: string, currentlyOpen: boolean) => void;
}

export const useToolRuns = create<ToolRunsState>((set) => ({
  open: {},
  toggle: (key, currentlyOpen) => set((state) => ({ open: { ...state.open, [key]: !currentlyOpen } })),
}));
