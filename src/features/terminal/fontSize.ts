import { create } from 'zustand';

import { terminal } from '@/theme/tokens';

/**
 * The terminal's font size, as the last pinch left it. For the app's life, not
 * saved: a size picked for `htop` on an iPad is not the size wanted next week
 * on a phone, and the default is what a person comes back to.
 */
export const useTerminalFont = create<{ size: number; set: (size: number) => void }>((set) => ({
  size: terminal.fontSize,
  set: (size) => set({ size: Math.min(terminal.maxFontSize, Math.max(terminal.minFontSize, size)) }),
}));
