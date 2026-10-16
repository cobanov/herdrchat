import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { useDeviceIcon } from '@/state/deviceIcons';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, size, spacing } from '@/theme/tokens';
import type { Device } from './useDevices';

/** The host and its machines as rows to open, each with the glyph it was given in Hosts. */
export function DeviceList({ devices, testIDPrefix, onOpen, footer }: {
  devices: readonly Device[];
  testIDPrefix: string;
  onOpen: (device: Device) => void;
  footer?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView contentContainerStyle={{ padding: screenPadding, gap: spacing.sm, paddingBottom: insets.bottom + size.floatingBarClearance }}>
      {devices.map((device) => (
        <DeviceRow key={device.connection.id} device={device} testID={`${testIDPrefix}-${device.connection.id}`} onPress={() => onOpen(device)} />
      ))}
      {footer !== undefined && (
        <Text variant="footnote" color="secondary" style={{ padding: spacing.md }}>
          {footer}
        </Text>
      )}
    </ScrollView>
  );
}

function DeviceRow({ device, testID, onPress }: { device: Device; testID: string; onPress: () => void }) {
  const { colors } = useTheme();
  const icon = useDeviceIcon(device.connection.id);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${device.name}`}
      testID={testID}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md,
        borderRadius: radius.sm, backgroundColor: colors.secondarySystemBackground, opacity: pressed ? 0.6 : 1,
      })}>
      <Icon name={icon ?? 'desktopcomputer'} size={size.rowStatusGlyph} tintColor={colors.tint} />
      <View style={{ flex: 1, gap: spacing.xxs }}>
        <Text variant="headline">{device.name}</Text>
        <Text variant="caption" color="secondary" numberOfLines={1}>{device.detail}</Text>
      </View>
      <Icon name="chevron.right" size={size.rowBadgeGlyph} tintColor={colors.tertiaryLabel} />
    </Pressable>
  );
}
