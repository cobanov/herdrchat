import { useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

import { threadAnnouncement, type ThreadMoment } from '@/lib/announce';

/**
 * Tells a screen reader when the open chat's agent stops to ask or replies
 * (`threadAnnouncement`). While the history loads there is no "before", so
 * what loads is not announced as new.
 */
export function useAnnouncements({ blocked, lastReply }: ThreadMoment, agent: string, loading: boolean): void {
  const before = useRef<ThreadMoment | null>(null);
  useEffect(() => {
    const now = loading ? null : { blocked, lastReply };
    const text = now === null ? null : threadAnnouncement(before.current, now, agent);
    before.current = now;
    if (text !== null) AccessibilityInfo.announceForAccessibility(text);
  }, [blocked, lastReply, agent, loading]);
}
