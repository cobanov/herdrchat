import { useFocusEffect } from 'expo-router';
import type * as SQLite from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';

import type { OpenChat, ReadsByConnection } from '@/features/chats/listedChat';
import { useChatEdits } from '@/state/chatEdits';
import { loadThreadReads } from '@/state/db';

/**
 * The read markers of every listed connection, which the rows' unread dots
 * compare against: every listed host's. `readIds` is their ids,
 * joined, so a rebuilt list of the same ids does not reload them.
 */
export function useListReads(
  db: SQLite.SQLiteDatabase,
  readIds: string,
  open: OpenChat | null,
  refresh: () => Promise<void>
): ReadsByConnection {
  const [reads, setReads] = useState<ReadsByConnection>(new Map());
  const editsDirty = useChatEdits((state) => state.dirty);
  const clearEdits = useChatEdits((state) => state.clear);
  // Re-read on focus rather than on an interval: the only thing that changes a
  // read marker is opening a thread, and coming back from one is exactly this
  // callback. A poll would just re-query the same rows every few seconds.
  useFocusEffect(
    useCallback(() => {
      if (readIds === '') return;
      void loadReads(db, readIds).then(setReads);
      // A rename happened in the sheet that just closed. Re-fetch rather than
      // wait out the poll, but only then, refreshing on every focus would cost
      // a round-trip each time a sheet above this list closes.
      if (editsDirty) {
        clearEdits();
        void refresh();
      }
    }, [db, readIds, editsDirty, clearEdits, refresh])
  );

  // The tablet list stays focused as its detail changes. Refresh read markers
  // after the previous detail has stamped its final read time on unmount.
  // By chat key, not workspace: moving between two agents of one workspace
  // closes a thread too.
  useEffect(() => {
    if (readIds === '' || open === null) return;
    let alive = true;
    void loadReads(db, readIds).then((next) => { if (alive) setReads(next); });
    return () => { alive = false; };
  }, [db, readIds, open]);
  return reads;
}

/** Every listed host's read markers. */
async function loadReads(db: SQLite.SQLiteDatabase, ids: string): Promise<ReadsByConnection> {
  const loaded = await Promise.all(ids.split('\n').map(async (id) => [id, await loadThreadReads(db, id)] as const));
  return new Map(loaded);
}
