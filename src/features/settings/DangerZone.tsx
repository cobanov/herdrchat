import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';

import { confirmDestructive } from '@/components/ActionSheet';
import { ActionRow, Divider, Section } from '@/components/SettingsList';
import { haptics } from '@/lib/haptics';
import { useConnections } from '@/state/connections';
import { clearCachedMessages } from '@/state/db';
import { resetAppData } from './reset';

/**
 * The two irreversible things, alone at the bottom, in red.
 *
 * Grouped and last because that is where a reader expects to find them and, more
 * to the point, where a reader scanning for something else will not land on them
 * by accident. Clear cache used to be a tinted button inside Storage, one flick
 * away from the toggles.
 *
 * The severities are deliberately different and both are stated in the row
 * itself: one costs you a reload, the other costs you your keys.
 */
export function DangerZone({ onCacheCleared }: { onCacheCleared: () => void }) {
  const db = useSQLiteContext();
  const connections = useConnections((state) => state.connections);
  const setAll = useConnections((state) => state.setAll);
  const [note, setNote] = useState<string | null>(null);

  const clearCache = () => {
    confirmDestructive({
      title: 'Clear cached messages?',
      message:
        'Threads reload from each host next time you open them. Nothing on your machines changes.',
      confirmLabel: 'Clear cache',
      onConfirm: () => {
        void clearCachedMessages(db).then(onCacheCleared);
      },
    });
  };

  const reset = () => {
    confirmDestructive({
      title: 'Erase all HerdrChat data?',
      message:
        'Every host, its saved key and pinned fingerprint, all cached conversations and your prompt history are deleted from this device. Nothing on your machines changes — but you will have to add your hosts and keys again.',
      confirmLabel: 'Erase everything',
      onConfirm: () => {
        void resetAppData(db, connections).then(({ remaining }) => {
          // The store is set from the OUTCOME, not optimistically. A host whose
          // keychain entry refused to delete still has its database row, and
          // showing an empty list anyway would hide data still on the device —
          // and leave the retry below with nothing to retry.
          setAll(remaining, null);
          if (remaining.length === 0) {
            haptics.success();
            setNote('Everything was erased.');
            return;
          }
          haptics.error();
          setNote(
            `Erased, except ${remaining
              .map((host) => (host.name.length > 0 ? host.name : host.host))
              .join(', ')} — the saved key would not delete. They are still listed under Hosts; try again.`
          );
        });
      },
    });
  };

  return (
    <Section title="Danger zone" tone="danger" footer={note ?? undefined}>
      <ActionRow
        label="Clear cached messages"
        detail="Threads reload from the host. Your hosts and keys are untouched."
        tone="destructive"
        accessory="none"
        onPress={clearCache}
        testID="clear-cache"
      />
      <Divider />
      <ActionRow
        label="Erase all data"
        detail="Hosts, keys, cached conversations and prompt history. This cannot be undone."
        tone="destructive"
        accessory="none"
        onPress={reset}
        testID="reset-app"
      />
    </Section>
  );
}
