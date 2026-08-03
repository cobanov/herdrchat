import { SymbolView } from 'expo-symbols';
import { View } from 'react-native';

import { Button } from './Button';
import { Text } from './Text';
import type { SymbolName } from './Symbol';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

/**
 * An empty state: an icon, one line of explanation, one clear action.
 *
 * Deliberately not a shrug — every empty state in this app is a place where the
 * user can do something, so the action is required rather than optional wherever
 * one exists.
 */
export function EmptyState({
  symbol,
  title,
  body,
  actionLabel,
  onAction,
}: {
  symbol: SymbolName;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.xxl,
        gap: spacing.md,
      }}>
      <SymbolView
        name={symbol}
        size={44}
        tintColor={colors.tertiaryLabel}
        fallback={<Text variant="largeTitle" color="tertiary">◦</Text>}
      />
      <Text variant="title3" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      <Text variant="subhead" color="secondary" style={{ textAlign: 'center' }}>
        {body}
      </Text>
      {actionLabel !== undefined && onAction !== undefined && (
        <View style={{ marginTop: spacing.sm }}>
          <Button title={actionLabel} onPress={onAction} />
        </View>
      )}
    </View>
  );
}
