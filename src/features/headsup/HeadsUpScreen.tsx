import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { KIND_LABEL, groups, openItems, summary } from '@/lib/headsup/items';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, screenPadding, spacing } from '@/theme/tokens';
import { goToHeadsUpChat, reopenHeadsUpItem, replyToHeadsUpItem, resolveHeadsUpItem } from './actions';
import { HeadsUpRow, type HeadsUpRowActions } from './HeadsUpRow';
import { useHeadsUpItems } from './useHeadsUpHosts';

/**
 * Heads Up: everything the mod's list says is waiting on the person, on every
 * listed host that runs it, grouped as the mod's pane groups it (questions,
 * follow-ups, failures, notes; blocking first, then newest). Opened from the
 * chats' bar, or from a chat's (`from`: that chat's session, whose own items
 * need no "from").
 */
export default function HeadsUpScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ from?: string }>();
  const from = typeof params.from === 'string' && params.from !== '' ? params.from : null;
  const { items, hostCount } = useHeadsUpItems();
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When the screen opened: "Today" means the day it was read on.
  const [now] = useState(() => Date.now());

  const all = items.map((entry) => entry.item);
  const open = openItems(all);
  const shown = showDone ? items : items.filter((entry) => entry.item.status === 'open');
  const actions: HeadsUpRowActions = {
    onDone: (entry) => resolveHeadsUpItem(entry.connectionId, entry.item),
    onReopen: (entry) => reopenHeadsUpItem(entry.connectionId, entry.item),
    onReply: (entry, reply) =>
      entry.chat === null ? Promise.resolve("That session isn't running here.") : replyToHeadsUpItem(entry.connectionId, entry.item, entry.chat, reply),
    onGo: (entry) => {
      if (entry.chat !== null) goToHeadsUpChat(entry.connectionId, entry.chat);
    },
    onError: setError,
  };

  return (
    <Screen presentation="sheet">
      <Header title="Heads Up" onClose={() => router.back()} />
      {error !== null && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      <ScrollView
        testID="headsup-list"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: screenPadding, paddingBottom: insets.bottom + spacing.xl, gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text testID="headsup-summary" variant="subhead" weight="600" style={{ flex: 1, minWidth: 0 }}>
            {open.length === 0 ? 'Nothing needs you.' : summary(open)}
          </Text>
          <Pressable
            testID="headsup-show-done"
            accessibilityRole="switch"
            accessibilityState={{ checked: showDone }}
            onPress={() => setShowDone((value) => !value)}
            style={{ minHeight: minTouchTarget, justifyContent: 'center' }}>
            <Text variant="footnote" color="tint">{showDone ? 'Hide done' : 'Show done'}</Text>
          </Pressable>
        </View>
        {groups(shown).map((group) => (
          <View key={group.kind} testID={`headsup-group-${group.kind}`}>
            <View accessibilityRole="header" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs }}>
              <Text variant="caption" mono color="secondary">{KIND_LABEL[group.kind][1].toUpperCase()}</Text>
              <View style={{ height: 1, flex: 1, backgroundColor: colors.separator }} />
            </View>
            {group.entries.map((entry) => (
              <HeadsUpRow
                key={`${entry.connectionId}/${entry.item.id}`}
                entry={entry}
                now={now}
                from={from}
                showHost={hostCount > 1}
                actions={actions}
              />
            ))}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
