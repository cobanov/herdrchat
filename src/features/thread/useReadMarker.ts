import { useFocusEffect } from 'expo-router';
import type * as SQLite from 'expo-sqlite';
import { useCallback, useEffect, useRef } from 'react';

import { sessionSignature, type AgentInfo } from '@/lib/herdr/models';
import { markThreadRead } from '@/state/db';

/**
 * Marks the chat read when it comes into focus and again when it leaves, so
 * a message that arrived while you were reading it counts as seen rather than
 * re-lighting the row you just left.
 */
export function useReadMarker(db: SQLite.SQLiteDatabase, connectionId: string | undefined, chat: string, agents: readonly AgentInfo[]) {
  // The agents change with every status change, so they cannot go in the
  // dependency list below: the read marker belongs to focus and blur, not to
  // an agent starting or stopping. A ref gives the callback the current value
  // while staying stable itself.
  const agentsRef = useRef(agents);
  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  useFocusEffect(
    useCallback(() => {
      if (connectionId === undefined || connectionId === '') return;
      const stamp = () => {
        // No session id yet means there is nothing to bind the marker to, and a
        // marker under the wrong signature is worse than none: it would silence
        // the chat that actually lands in this workspace slot.
        const sig = sessionSignature(agentsRef.current);
        if (sig === null) return;
        void markThreadRead(db, connectionId, chat, sig, Date.now());
      };
      stamp();
      return stamp;
    }, [db, connectionId, chat])
  );
}
