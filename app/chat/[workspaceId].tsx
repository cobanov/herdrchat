import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Bubble } from '@/components/Bubble';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Text } from '@/components/Text';
import { TypingDots, WaitingBar } from '@/components/Activity';
import { BlockedBar } from '@/features/thread/BlockedBar';
import { Composer } from '@/features/thread/Composer';
import { LivePreviewBubble } from '@/features/thread/LivePreviewBubble';
import { useThread } from '@/features/thread/useThread';
import { clientFor, useSelectedConnection } from '@/state/connections';
import { isToolOnly, type ChatMessage } from '@/lib/transcript/message';
import { modelDisplayName } from '@/lib/transcript/sessionMeta';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, spacing } from '@/theme/tokens';

/** One workspace conversation. */
export default function ThreadScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ workspaceId: string; title?: string }>();
  const connection = useSelectedConnection();
  const client = useMemo(() => (connection === null ? null : clientFor(connection)), [connection]);
  const listRef = useRef<FlashListRef<Row>>(null);
  /** Did the READER move the list? Content growing must never count as that. */
  const readerTookOver = useRef(false);

  const thread = useThread(db, client, connection?.id ?? '', params.workspaceId, []);

  const rows = useMemo(() => buildRows(thread.messages), [thread.messages]);
  const waiting = !thread.isBlocked && (thread.status === 'working' || thread.isSending);

  // Stay pinned to the newest message unless the reader scrolled away. A long
  // transcript arrives in phases (cache seed → recent window → live tail), so
  // this has to re-assert on every phase rather than latching on the first.
  useEffect(() => {
    if (readerTookOver.current || rows.length === 0) return;
    listRef.current?.scrollToEnd({ animated: false });
  }, [rows.length]);

  const subtitle = [
    modelDisplayName(thread.sessionMeta?.model ?? null),
    thread.workingDirName,
    statusWord(thread.status),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.systemBackground }} edges={['top']}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.sm,
          paddingBottom: spacing.sm,
          gap: spacing.xs,
        }}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to chats"
          testID="thread-back"
          style={{ width: minTouchTarget, height: minTouchTarget, alignItems: 'center', justifyContent: 'center' }}>
          <SymbolView
            name="chevron.left"
            size={20}
            tintColor={colors.tint}
            fallback={<Text color="tint">‹</Text>}
          />
        </Pressable>

        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="headline" numberOfLines={1}>
            {params.title ?? params.workspaceId}
          </Text>
          {subtitle.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: statusColor(thread.status, colors),
                }}
              />
              <Text
                variant="caption2"
                color={thread.status === 'blocked' ? 'attention' : 'secondary'}
                numberOfLines={1}>
                {subtitle}
              </Text>
              {thread.status === 'working' && <TypingDots size={3.5} />}
            </View>
          )}
        </View>

        <View style={{ width: minTouchTarget }} />
      </View>

      <FlashList
        ref={listRef}
        data={rows}
        keyExtractor={(row) => row.message.id}
        contentContainerStyle={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
        onScrollBeginDrag={() => {
          readerTookOver.current = true;
        }}
        renderItem={({ item }) => (
          <View style={{ paddingTop: item.startsGroup ? spacing.sm + 2 : 2 }}>
            {item.startsGroup && item.message.agentLabel !== null && item.message.role !== 'user' && (
              <Text variant="caption2" color="secondary" style={{ paddingLeft: spacing.md + 2 }}>
                {item.message.agentLabel}
              </Text>
            )}
            <Bubble
              message={item.message}
              isLastInGroup={item.endsGroup}
              timeLabel={item.endsGroup ? formatTime(item.message.timestamp) : null}
            />
            {thread.failedIds.has(item.message.id) && (
              <Pressable
                onPress={() => void thread.retry(item.message.id)}
                accessibilityRole="button"
                accessibilityLabel="Failed to send. Retry."
                style={{ alignSelf: 'flex-end', paddingVertical: spacing.xs }}>
                <Text variant="caption" color="attention">
                  Failed to send — retry
                </Text>
              </Pressable>
            )}
          </View>
        )}
        ListEmptyComponent={
          waiting ? null : (
            <View style={{ paddingVertical: spacing.xxxl, alignItems: 'center', gap: spacing.sm }}>
              <Text variant="title3">No messages yet</Text>
              <Text variant="subhead" color="secondary" style={{ textAlign: 'center' }}>
                Send your first message — {params.title ?? 'this workspace'} is ready.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          waiting ? (
            <View style={{ paddingTop: spacing.md }}>
              {thread.livePreview !== null ? (
                <LivePreviewBubble text={thread.livePreview} />
              ) : (
                <View style={{ paddingHorizontal: spacing.xxl, paddingVertical: spacing.md }}>
                  <WaitingBar />
                </View>
              )}
            </View>
          ) : null
        }
      />

      {thread.error !== null && (
        <ErrorBanner message={thread.error} onDismiss={thread.clearError} />
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ gap: spacing.sm, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm }}>
          {thread.isBlocked && (
            <BlockedBar prompt={thread.blockedPrompt} onKeys={(keys) => void thread.sendKeys(keys)} />
          )}
          <Composer onSend={(text) => void thread.send(text)} disabled={thread.isSending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

interface Row {
  message: ChatMessage;
  startsGroup: boolean;
  endsGroup: boolean;
}

/**
 * Bubbles worth showing, with run boundaries precomputed.
 *
 * Sidechain chatter (subagent internals) and raw tool-result turns are hidden:
 * a tool result arrives as a "user" turn, and rendering it as something the
 * person typed would be actively wrong.
 */
function buildRows(messages: readonly ChatMessage[]): Row[] {
  const visible = messages.filter(
    (message) => !message.isSidechain && !(message.role === 'user' && isToolOnly(message))
  );
  return visible.map((message, index) => {
    const previous = index > 0 ? visible[index - 1] : undefined;
    const next = index + 1 < visible.length ? visible[index + 1] : undefined;
    return {
      message,
      startsGroup:
        previous === undefined ||
        previous.role !== message.role ||
        previous.agentLabel !== message.agentLabel,
      endsGroup:
        next === undefined || next.role !== message.role || next.agentLabel !== message.agentLabel,
    };
  });
}

function statusWord(status: string): string | null {
  switch (status) {
    case 'working':
      return 'working';
    case 'blocked':
      return 'waiting for reply';
    case 'done':
      return 'done';
    case 'idle':
      return 'online';
    default:
      return null;
  }
}

function statusColor(status: string, colors: ReturnType<typeof useTheme>['colors']): string {
  if (status === 'blocked') return colors.attention;
  if (status === 'working' || status === 'done') return colors.tint;
  return colors.tertiaryLabel;
}

function formatTime(timestamp: number | null): string | null {
  if (timestamp === null) return null;
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
