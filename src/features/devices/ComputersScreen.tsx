import { useRouter } from 'expo-router';
import { useState } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { FolderBrowser } from '@/features/files/FolderBrowser';
import { MAX_TRANSFER_BYTES } from '@/lib/files/remoteFiles';
import { useSelectedConnection } from '@/state/connections';
import { DeviceList } from './DeviceList';
import { useDevices, type Device } from './useDevices';

/**
 * The Computers tab: every saved host, each with its files and a terminal. Files browse here, in the tab; the terminal is a login
 * shell on that computer, on the terminal screen every pane uses, pushed over
 * the tabs so its keyboard bar and swipe back are the same.
 */
export default function ComputersScreen() {
  const router = useRouter();
  const host = useSelectedConnection();
  const devices = useDevices();
  const [browsing, setBrowsing] = useState<Device | null>(null);
  // A computer that left the list (its host removed) closes its folders.
  const open = browsing !== null && devices.some((item) => item.connection.id === browsing.connection.id) ? browsing : null;

  if (open !== null) return <FolderBrowser key={open.connection.id} device={open} onClose={() => setBrowsing(null)} />;
  return (
    <Screen>
      <Header title="Computers" subtitle={host?.name ?? null} onSubtitlePress={() => router.navigate('/hosts')} />
      {devices.length === 0 ? (
        <EmptyState
          symbol="desktopcomputer"
          title="No host yet"
          body="Add a computer that runs herdr, then open its files and a terminal from here."
          actionLabel="Add a host"
          onAction={() => router.navigate('/hosts')}
        />
      ) : (
        <DeviceList
          devices={devices}
          footer={`Files travel over the same SSH connection as your chats, up to ${MAX_TRANSFER_BYTES / 1024 / 1024} MB each. The terminal opens your login shell.`}
          onFiles={setBrowsing}
          onTerminal={(device) =>
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
