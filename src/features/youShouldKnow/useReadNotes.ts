import { useEffect } from 'react';

import { YSK_READ_INTERVAL_MS } from '@/lib/youShouldKnow/client';
import { clientFor, resolveConnection } from '@/state/connections';
import { checkYouShouldKnow } from '@/state/youShouldKnow';
import { usePollGate } from '../usePollGate';

/**
 * Keeps the given hosts' notes current while the screen showing them is on
 * top: reads each store as it opens, then on the chats' cadence. The notes
 * screen needs its own reads because it is a modal over the chat list, whose
 * poll (the other reader) pauses while it is covered; without them a note
 * answered at the computer, or cleared by the terminal after two prompts,
 * stayed on the screen with its buttons.
 */
export function useReadNotes(connectionIds: readonly string[]): void {
  const polling = usePollGate();
  // A string, so a new array of the same hosts restarts nothing.
  const key = connectionIds.join('\n');

  // Not state: the store is outside this component, and the check never rejects.
  useEffect(() => {
    if (!polling || key === '') return;
    const read = () => {
      for (const id of key.split('\n')) {
        const connection = resolveConnection(id);
        if (connection !== null) void checkYouShouldKnow(id, clientFor(connection).transport);
      }
    };
    read();
    const timer = setInterval(read, YSK_READ_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [key, polling]);
}
