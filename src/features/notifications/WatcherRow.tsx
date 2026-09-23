import { View } from 'react-native';

import { Button } from '@/components/Button';
import { ROW_INSET } from '@/components/SettingsList';
import { Text } from '@/components/Text';
import { isOutdated, type WatcherState } from '@/lib/notifier/watcher';
import { spacing } from '@/theme/tokens';
import type { WatcherControl } from './useWatcher';

/**
 * What the watcher on the selected host is doing, and the one action that fits.
 * Without a watcher there are no notifications at all, whatever the switch
 * says, so this is where "on" becomes true.
 */
export function WatcherRow({ host, watcher }: { host: string; watcher: WatcherControl }) {
  const { state, busy, error, install } = watcher;
  if (state === null) return null;
  const { message, detail, action } = describe(state, host);

  return (
    <View style={{ paddingHorizontal: ROW_INSET, paddingVertical: spacing.sm, gap: spacing.sm }} testID="watcher-row">
      <Text variant="footnote" color="secondary">
        {message}
      </Text>
      {detail !== undefined && (
        <Text variant="caption" color="secondary">
          {detail}
        </Text>
      )}
      {action !== undefined && (
        <Button
          title={busy ? 'Working…' : action}
          variant="tinted"
          disabled={busy}
          onPress={() => void install()}
          testID="watcher-install"
        />
      )}
      {error !== null && (
        <Text variant="caption" color="destructive">
          {error}
        </Text>
      )}
    </View>
  );
}

function describe(state: WatcherState, host: string): { message: string; detail?: string; action?: string } {
  switch (state.kind) {
    case 'no_python':
      return {
        message: `The watcher needs python3, which ${host} doesn't have.`,
        detail: 'Install Python 3 there, then come back here.',
      };
    case 'missing':
      return state.manual
        ? {
            message: `A watcher you started by hand is running on ${host}.`,
            detail: 'Installing it as a service keeps it running after a restart.',
            action: 'Install as a service',
          }
        : {
            message: `Nothing on ${host} sends notifications yet.`,
            detail:
              "The watcher is a small script that runs there as a background service and tells HerdrChat's relay when an agent needs you.",
            action: `Install watcher on ${host}`,
          };
    case 'stopped':
      return { message: `The watcher on ${host} isn't running.`, action: 'Start watcher' };
    case 'running': {
      if (isOutdated(state)) {
        return { message: `${host} runs an older watcher.`, action: 'Update watcher' };
      }
      const detail =
        state.service === 'process'
          ? `It runs until ${host} restarts; install it again after that.`
          : state.lingering === false
            ? `It stops when you log out of ${host}. Running "loginctl enable-linger" there keeps it going.`
            : undefined;
      return { message: `Watcher running on ${host}.`, detail };
    }
  }
}
