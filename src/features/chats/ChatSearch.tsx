import { TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, screenPadding, spacing, typography } from '@/theme/tokens';

/** The chat list's search field. */
export function ChatSearch({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ paddingHorizontal: screenPadding, paddingBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: colors.chatCard }}>
        <Icon name="magnifyingglass" tintColor={colors.secondaryLabel} />
        <TextInput
          testID="chat-search"
          accessibilityLabel="Search chats"
          placeholder="Search chats"
          placeholderTextColor={colors.secondaryLabel}
          value={query}
          onChangeText={onChange}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          style={{ flex: 1, minWidth: 0, minHeight: minTouchTarget, paddingVertical: spacing.md, color: colors.label, fontSize: typography.body.fontSize }}
        />
      </View>
    </View>
  );
}
