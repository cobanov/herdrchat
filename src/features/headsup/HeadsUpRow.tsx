import { useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import { askedAt, isAnswerable, raisedBy } from '@/lib/headsup/items';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, spacing, typography } from '@/theme/tokens';
import type { HostItem } from './useHeadsUpHosts';

/** What a row asks the screen to do. Each resolves to null, or the sentence saying why it did not happen. */
export interface HeadsUpRowActions {
  onDone: (entry: HostItem) => Promise<string | null>;
  onReply: (entry: HostItem, reply: string) => Promise<string | null>;
  onReopen: (entry: HostItem) => Promise<string | null>;
  onGo: (entry: HostItem) => void;
  onError: (message: string) => void;
}

/** A small action, as the mod's pane draws its buttons. */
function Action({ label, testID, onPress, disabled = false, accent = false }: {
  label: string;
  testID: string;
  onPress: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={spacing.xs}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      style={({ pressed }) => ({
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radius.full,
        backgroundColor: pressed || disabled ? colors.fillSubtle : accent ? colors.tint : colors.tintMuted,
      })}>
      <Text variant="footnote" weight="600" color={disabled ? 'secondary' : accent ? 'onTint' : 'tint'}>{label}</Text>
    </Pressable>
  );
}

/**
 * One item on the Heads Up screen: its text (in the attention colour while it
 * blocks Claude), when it was raised and from where, its detail, and what can
 * be done with it, which depends on its kind as in the mod's pane:
 *
 * - a question or follow-up is answered, never dismissed: Reply sends to the
 *   session that asked (when that session is a chat here), Go opens it, and
 *   Claude closes it once it has acted on the reply. One whose session is not
 *   running here can only be cleared.
 * - a failure is closed, and Go opens the chat it happened in.
 * - a note is ticked off.
 */
export function HeadsUpRow({ entry, now, from, showHost, actions }: {
  entry: HostItem;
  now: number;
  /** The Claude session of the chat the screen was opened from, whose items need no "from". */
  from: string | null;
  showHost: boolean;
  actions: HeadsUpRowActions;
}) {
  const { colors } = useTheme();
  const { item, chat } = entry;
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const isOpen = item.status === 'open';
  const answerable = isAnswerable(item);
  const replied = item.repliedAt !== null;
  const reachable = chat !== null;
  const canReply = isOpen && answerable && reachable && !replied;
  const fromHere = from !== null && raisedBy(item, from);
  const meta = [
    askedAt(item.createdAt, now),
    fromHere || item.folder === '' ? null : `from ${item.folder}`,
    showHost ? entry.hostName : null,
  ].filter((part): part is string => part !== null).join(' · ');

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    const error = await work();
    setBusy(false);
    if (error !== null) actions.onError(error);
    return error === null;
  };
  const send = async () => {
    if (draft.trim() === '') return;
    if (await run(() => actions.onReply(entry, draft))) {
      setDraft('');
      setReplying(false);
    }
  };

  return (
    <View testID={`headsup-item-${item.id}`} style={{ gap: spacing.xs, paddingVertical: spacing.sm }}>
      <Text
        variant="subhead"
        weight={isOpen ? '600' : undefined}
        color={!isOpen ? 'secondary' : item.blocking ? 'attention' : 'label'}
        style={isOpen ? undefined : { textDecorationLine: 'line-through' }}>
        {isOpen ? item.text : `✓ ${item.text}`}
      </Text>
      <Text variant="caption" color="secondary">{meta}</Text>
      {isOpen && item.detail !== null && (
        <Text variant="footnote" color="secondary">{item.detail}</Text>
      )}

      {isOpen && answerable && !reachable && (
        <Text variant="footnote" color="secondary" testID={`headsup-unreachable-${item.id}`}>
          {"That session isn't running here. Reply in it on the computer, or ✓ to clear."}
        </Text>
      )}
      {isOpen && answerable && replied && (
        <Text variant="footnote" color="secondary" testID={`headsup-replied-${item.id}`}>Reply sent, waiting for Claude.</Text>
      )}

      {isOpen && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xs }}>
          {canReply && !replying && (
            <Action label="Reply" testID={`headsup-reply-${item.id}`} disabled={busy} onPress={() => setReplying(true)} />
          )}
          {answerable && replied && (
            <Action label="Reply again" testID={`headsup-reply-again-${item.id}`} disabled={busy} onPress={() => void run(() => actions.onReopen(entry))} />
          )}
          {item.kind === 'failure' && (
            <Action label="Close" testID={`headsup-close-${item.id}`} disabled={busy} onPress={() => void run(() => actions.onDone(entry))} />
          )}
          {(item.kind === 'note' || (answerable && !reachable)) && (
            <Action label="✓" testID={`headsup-done-${item.id}`} disabled={busy} onPress={() => void run(() => actions.onDone(entry))} />
          )}
          {reachable && item.kind !== 'note' && (
            <Action label="Go" testID={`headsup-go-${item.id}`} onPress={() => actions.onGo(entry)} />
          )}
          {busy && <ActivityIndicator size="small" color={colors.secondaryLabel} />}
        </View>
      )}

      {canReply && replying && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <TextInput
            testID={`headsup-reply-field-${item.id}`}
            accessibilityLabel={`Reply to ${item.folder || 'Claude'}`}
            placeholder={fromHere || item.folder === '' ? 'Reply…' : `Reply to ${item.folder}…`}
            placeholderTextColor={colors.tertiaryLabel}
            value={draft}
            onChangeText={setDraft}
            autoFocus
            returnKeyType="send"
            onSubmitEditing={() => void send()}
            editable={!busy}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: minTouchTarget,
              paddingHorizontal: spacing.md,
              borderRadius: radius.sm,
              backgroundColor: colors.chatCard,
              color: colors.label,
              fontSize: typography.body.fontSize,
            }}
          />
          <Action label="Send" testID={`headsup-send-${item.id}`} accent disabled={busy || draft.trim() === ''} onPress={() => void send()} />
        </View>
      )}
    </View>
  );
}
