import { useRouter } from 'expo-router';

import { EmptyState } from '@/components/EmptyState';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { useSelectedConnection } from '@/state/connections';
import { DeviceList } from './DeviceList';
import { useDevices } from './useDevices';

/**
 * The Terminal tab: a login shell on the host or one of its machines, over the
 * SSH connection the app already holds (a machine's through its host, as its
 * chats are). Not a herdr pane: what a pane's terminal attaches to is opened
 * from its chat instead. The shell is the terminal screen every pane uses,
 * pushed over the tabs, so its keyboard bar and swipe back are the same.
 */
export default function TerminalTab() {
  const router = useRouter();
  const host = useSelectedConnection();
  const devices = useDevices();

  return (
    <Screen>
      <Header title="Terminal" subtitle={host?.name ?? null} onSubtitlePress={() => router.navigate('/hosts')} />
      {devices.length === 0 ? (
        <EmptyState
          symbol="terminal"
          title="No host yet"
          body="Add a machine that runs herdr, and open a shell on it, or on any machine it reaches, from here."
          actionLabel="Add a host"
          onAction={() => router.navigate('/hosts')}
        />
      ) : (
        <DeviceList
          devices={devices}
          testIDPrefix="terminal-device"
          footer="Opens your login shell on that computer. Its machines are reached through the host, as their chats are."
          onOpen={(device) =>
            router.push({
              pathname: '/chat/terminal',
              params: { connectionId: device.connection.id, paneId: '', kind: 'login', title: device.name },
            })
          }
        />
      )}
    </Screen>
  );
}
