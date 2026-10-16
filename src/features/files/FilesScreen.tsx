import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Header } from '@/components/Header';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { DeviceList } from '@/features/devices/DeviceList';
import { useDevices, type Device } from '@/features/devices/useDevices';
import { childPath, downloadFile, MAX_TRANSFER_BYTES, parentPath, uploadFile, type RemoteEntry } from '@/lib/files/remoteFiles';
import { INSTALL_TIMEOUT_MS } from '@/lib/herdr/timeouts';
import { clientFor, useSelectedConnection } from '@/state/connections';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, size, spacing } from '@/theme/tokens';
import { useRemoteFolder } from './useRemoteFolder';

/**
 * The Files tab: the folders of the host and its machines, over the SSH
 * connection the app already holds. A file tapped comes to the phone and opens
 * the share sheet (Save to Files, AirDrop, another app); "+" sends a file from
 * the phone into the folder on screen. See `lib/files/remoteFiles` for how,
 * and for the size cap.
 */
export default function FilesScreen() {
  const router = useRouter();
  const host = useSelectedConnection();
  const devices = useDevices();
  const [device, setDevice] = useState<Device | null>(null);
  // A device that left the list (another host picked, a machine disabled) closes its browser.
  const open = device !== null && devices.some((item) => item.connection.id === device.connection.id) ? device : null;

  if (open !== null) return <FolderBrowser key={open.connection.id} device={open} onClose={() => setDevice(null)} />;
  return (
    <Screen>
      <Header title="Files" subtitle={host?.name ?? null} onSubtitlePress={() => router.navigate('/hosts')} />
      {devices.length === 0 ? (
        <EmptyState
          symbol="folder"
          title="No host yet"
          body="Add a machine that runs herdr, and move files to and from it, or any machine it reaches, from here."
          actionLabel="Add a host"
          onAction={() => router.navigate('/hosts')}
        />
      ) : (
        <DeviceList
          devices={devices}
          testIDPrefix="files-device"
          footer={`Files travel over the same SSH connection as your chats, up to ${MAX_TRANSFER_BYTES / 1024 / 1024} MB each.`}
          onOpen={setDevice}
        />
      )}
    </Screen>
  );
}

function FolderBrowser({ device, onClose }: { device: Device; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const client = clientFor(device.connection);
  const [path, setPath] = useState<string | null>(null);
  const folder = useRemoteFolder(client, path);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = folder.listing?.path ?? path;
  const up = shown === null ? null : parentPath(shown);

  const transfer = async (label: string, work: () => Promise<string | null>) => {
    setBusy(label);
    setProblem(null);
    try {
      setProblem(await work());
    } catch (thrown) {
      setProblem(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(null);
    }
  };

  const download = (entry: RemoteEntry) =>
    transfer(`Downloading ${entry.name}…`, async () => {
      if (folder.listing === null) return null;
      if (entry.size > MAX_TRANSFER_BYTES) return `${entry.name} is over ${MAX_TRANSFER_BYTES / 1024 / 1024} MB, too big to bring over here.`;
      const result = await downloadFile(client.transport, childPath(folder.listing.path, entry.name), INSTALL_TIMEOUT_MS);
      if (!result.ok) return result.message;
      const downloads = new Directory(Paths.cache, 'downloads');
      downloads.create({ idempotent: true, intermediates: true });
      const copy = new File(downloads, entry.name);
      if (copy.exists) copy.delete();
      copy.write(result.value, { encoding: 'base64' });
      // shortcut: Android's Share takes no file, so the copy stays in the app's cache there.
      if (Platform.OS === 'ios') await Share.share({ url: copy.uri });
      else return `Saved to the app's storage as ${entry.name}. Sharing a file is iPhone and iPad only for now.`;
      return null;
    });

  const upload = () =>
    transfer('Sending…', async () => {
      if (folder.listing === null) return null;
      const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      const asset = picked.canceled ? undefined : picked.assets[0];
      if (asset === undefined) return null;
      if ((asset.size ?? 0) > MAX_TRANSFER_BYTES) return `${asset.name} is over ${MAX_TRANSFER_BYTES / 1024 / 1024} MB, too big to send from here.`;
      const base64 = await new File(asset.uri).base64();
      const result = await uploadFile(client.transport, folder.listing.path, asset.name, base64, INSTALL_TIMEOUT_MS);
      if (!result.ok) return result.message;
      folder.reload();
      return null;
    });

  const title = shown === null ? device.name : shown === '/' ? '/' : shown.split('/').filter(Boolean).pop() ?? shown;

  return (
    <Screen>
      <Header
        title={title}
        subtitle={device.name}
        actionSymbol="plus"
        actionLabel="Send a file here"
        onAction={busy !== null || folder.listing === null ? undefined : () => void upload()}
        menuSymbol="arrow.clockwise"
        menuLabel="Reload"
        menuTestID="files-reload"
        onMenu={folder.reload}
      />
      <View style={{ flexDirection: 'row', gap: spacing.sm, paddingHorizontal: screenPadding, paddingBottom: spacing.sm }}>
        <Chip symbol="chevron.left" label="Computers" testID="files-devices" onPress={onClose} />
        {up !== null && <Chip symbol="arrow.up" label="Up" testID="files-up" onPress={() => setPath(up)} />}
        {shown !== null && (
          <Text variant="caption" color="secondary" mono numberOfLines={1} style={{ flex: 1, alignSelf: 'center' }}>
            {shown}
          </Text>
        )}
      </View>
      {(problem ?? folder.error) !== null && <ErrorBanner message={problem ?? folder.error ?? ''} onDismiss={problem !== null ? () => setProblem(null) : undefined} />}
      {busy !== null && (
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingHorizontal: screenPadding, paddingBottom: spacing.sm }}>
          <ActivityIndicator size="small" color={colors.tint} />
          <Text variant="footnote" color="secondary">{busy}</Text>
        </View>
      )}
      <ScrollView contentContainerStyle={{ paddingHorizontal: screenPadding, paddingBottom: insets.bottom + size.floatingBarClearance }}>
        {folder.loading && folder.listing === null ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.tint} /> : null}
        {folder.listing?.entries.length === 0 && <Text variant="subhead" color="secondary" style={{ padding: spacing.md }}>This folder is empty.</Text>}
        {folder.listing?.entries.map((entry) => (
          <Pressable
            key={entry.name}
            disabled={busy !== null}
            onPress={() => {
              const listing = folder.listing;
              if (listing === null) return;
              // A link is tried as a folder; the host says if it is not one.
              if (entry.kind === 'file') void download(entry);
              else setPath(childPath(listing.path, entry.name));
            }}
            accessibilityRole="button"
            accessibilityLabel={entry.kind === 'file' ? `Download ${entry.name}` : `Open ${entry.name}`}
            testID={`files-entry-${entry.name}`}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm,
              borderBottomWidth: 1, borderBottomColor: colors.separator, opacity: pressed ? 0.5 : 1,
            })}>
            <Icon name={entry.kind === 'file' ? 'doc' : 'folder.fill'} size={size.rowStatusGlyph} tintColor={entry.kind === 'file' ? colors.secondaryLabel : colors.tint} />
            <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>{entry.name}</Text>
            {entry.kind === 'file' && <Text variant="caption" color="secondary">{formatBytes(entry.size)}</Text>}
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

function Chip({ symbol, label, testID, onPress }: { symbol: 'chevron.left' | 'arrow.up'; label: string; testID: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      hitSlop={spacing.xs}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
        borderRadius: radius.sm, backgroundColor: colors.secondarySystemBackground, opacity: pressed ? 0.5 : 1,
      })}>
      <Icon name={symbol} size={size.rowBadgeGlyph} tintColor={colors.tint} />
      <Text variant="footnote" color="tint" weight="600">{label}</Text>
    </Pressable>
  );
}

/** `1.2 MB`, `340 KB`, `12 B`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
