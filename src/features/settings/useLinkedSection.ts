import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScrollView } from 'react-native';

import { spacing } from '@/theme/tokens';
import { isSettingsSection, type SettingsSection } from './HighlightOnLink';

/**
 * Arriving from `/(tabs)/settings?section=…`.
 *
 * Sections report their own y as they lay out, because the offset depends on
 * Dynamic Type, on whether a note is showing under the notifications switch, and
 * on how many hosts the card has to describe. A table of constants would be
 * wrong on the first phone with larger text.
 *
 * The scroll waits for the section to have measured. A link can arrive before
 * layout — that is the normal case, not the exception — so the request is held
 * and spent once the offset exists.
 */
export function useLinkedSection(): {
  target: SettingsSection | null;
  scrollRef: React.RefObject<ScrollView | null>;
  onMeasure: (section: SettingsSection, y: number) => void;
} {
  const params = useLocalSearchParams<{ section?: string }>();
  const requested = isSettingsSection(params.section) ? params.section : null;

  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef(new Map<SettingsSection, number>());
  const [target, setTarget] = useState<SettingsSection | null>(null);
  /**
   * Which request has already been acted on.
   *
   * Without it, every re-render re-reads the same `section` param and scrolls
   * the reader back to where they arrived — so flipping the toggle they were
   * sent to would yank the screen each time.
   */
  const spent = useRef<string | null>(null);

  const scrollTo = useCallback((section: SettingsSection) => {
    const y = offsets.current.get(section);
    if (y === undefined) return;
    // A little above the section, so it does not sit flush against the header
    // and read as the top of the screen rather than as a place scrolled to.
    scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.lg), animated: true });
  }, []);

  const onMeasure = useCallback(
    (section: SettingsSection, y: number) => {
      offsets.current.set(section, y);
      // The link that arrived before this section existed, spent now that it
      // does.
      if (requested === section && spent.current !== requested) {
        spent.current = requested;
        setTarget(requested);
        scrollTo(section);
      }
    },
    [requested, scrollTo]
  );

  useEffect(() => {
    if (requested === null || spent.current === requested) return;
    // Already measured — a second visit to the screen, where layout has
    // happened and `onLayout` will not fire again.
    if (offsets.current.has(requested)) {
      spent.current = requested;
      setTarget(requested);
      scrollTo(requested);
    }
  }, [requested, scrollTo]);

  return { target, scrollRef, onMeasure };
}
