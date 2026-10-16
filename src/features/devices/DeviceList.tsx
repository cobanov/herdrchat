import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/Icon';
import { Text } from '@/components/Text';
import { useDeviceIcon } from '@/state/deviceIcons';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, screenPadding, size, spacing } from '@/theme/tokens';
import type { Device } from './useDevices';

/** The host and its machines, each with the glyph it was given in Hosts and a button for its files and its terminal. */
export function DeviceList({ devices, onFiles, onTerminal, footer }: {
  devices: readonly Device[];
  onFiles: (device: Device) => void;
  onTerminal: (device: Device) => void;
  footer?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView contentContainerStyle={{ padding: screenPadding, gap: spacing.sm, paddingBottom: insets.bottom + size.floatingBarClearance }}>
      {devices.map((device) => (
        <DeviceRow key={device.connection.id} device={device} onFiles={() => onFiles(device)} onTerminal={() => onTerminal(device)} />
      ))}
      {footer !== undefined && (
        <Text variant="footnote" color="secondary" style={{ padding: spacing.md }}>
          {footer}
        </Text>
      )}
    </ScrollView>
  );
}

function DeviceRow({ device, onFiles, onTerminal }: { device: Device; onFiles: () => void; onTerminal: () => void }) {
  const { colors } = useTheme();
  const icon = useDeviceIcon(device.connection.id);
  const id = device.connection.id;
  return (
    <View
      testID={`device-${id}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.sm, backgroundColor: colors.secondarySystemBackground }}>
      <Icon name={icon ?? 'desktopcomputer'} size={size.rowStatusGlyph} tintColor={colors.tint} />
      <View style={{ flex: 1, gap: spacing.xxs }}>
        <Text variant="headline" numberOfLines={1}>{device.name}</Text>
        <Text variant="caption" color="secondary" numberOfLines={1}>{device.detail}</Text>
      </View>
      <RowButton symbol="folder" label={`Files on ${device.name}`} testID={`device-files-${id}`} onPress={onFiles} />
      <RowButton symbol="terminal" label={`Terminal on ${device.name}`} testID={`device-terminal-${id}`} onPress={onTerminal} />
    </View>
  );
}

function RowButton({ symbol, label, testID, onPress }: { symbol: IconName; label: string; testID: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => ({
        width: minTouchTarget, height: minTouchTarget, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
        backgroundColor: colors.tintMuted, opacity: pressed ? 0.5 : 1,
      })}>
      <Icon name={symbol} size={size.rowStatusGlyph} tintColor={colors.tint} />
    </Pressable>
  );
}
