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
        void resetAppData(db, connections).then(({ failed }) => {
          // The store is reset from the outcome rather than optimistically: a
          // host whose keychain entry refused to delete still has its row, and
          // clearing the list anyway would hide something still on the device.
          setAll([], null);
          if (failed.length === 0) {
            haptics.success();
            setNote('Everything was erased.');
            return;
          }
          haptics.error();
          setNote(
            `Erased, except the saved key for ${failed.join(', ')}. Reopen this screen and try again.`
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
