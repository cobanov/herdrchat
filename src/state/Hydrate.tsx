import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, type ReactNode } from 'react';

import { useConnections } from './connections';
import { getSetting, loadConnections } from './db';

const SELECTED_KEY = 'selectedConnectionId';

/**
 * Loads persisted state into the store before the tree below it renders
 * anything that depends on it.
 *
 * Children render immediately rather than behind a spinner: every screen already
 * has to handle "no servers yet", and flashing a loader for a query that takes a
 * few milliseconds is worse than briefly showing the empty state it resolves to.
 */
export function Hydrate({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const setAll = useConnections((state) => state.setAll);

  useEffect(() => {
    void (async () => {
      const [connections, selected] = await Promise.all([
        loadConnections(db),
        getSetting(db, SELECTED_KEY),
      ]);
      setAll(connections, selected);
    })();
  }, [db, setAll]);

  return <>{children}</>;
}

export { SELECTED_KEY };
