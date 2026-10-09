import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import {
  DelegationScopeProvider,
  useClientFor,
  useDelegationStates,
  type AgentTarget,
  type DelegationScope,
} from '@/features/thread/delegation';
import { JumpToBottom } from '@/features/thread/JumpToBottom';
import { OlderHistory } from '@/features/thread/OlderHistory';
import { ReadOnlyHeader } from '@/features/thread/ReadOnlyHeader';
import { ThreadRow } from '@/features/thread/ThreadRow';
import { useAgentPath } from '@/features/thread/useAgentPath';
import { useThreadScroll } from '@/features/thread/useThreadScroll';
import { useTranscript } from '@/features/thread/useTranscript';
import { sessionDir } from '@/lib/subagents/paths';
import { threadItems, type DelegationState, type PlacedItem } from '@/lib/threadItems';
import { modelDisplayName } from '@/lib/transcript/sessionMeta';
import { useTheme } from '@/theme/ThemeProvider';
import { screenPadding, size, spacing, threadLayout } from '@/theme/tokens';

/**
 * A subagent's own transcript, read only: the same bubbles, tool runs and
 * subagent cards as the thread it came from (an agent can start agents of its
 * own), following live while it runs. No composer, no blocked bar: nothing
 * typed here would reach it.
 */
export default function SubagentScreen({
  connectionId,
  workspaceId,
  dirs,
  target,
  title,
  subtitle,
  followKey,
  initialState,
  onBack,
}: {
  connectionId: string;
  workspaceId: string;
  dirs: readonly string[];
  target: AgentTarget | null;
  title: string;
  subtitle: string;
  followKey: string;
  initialState: DelegationState;
  onBack: () => void;
}) {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const client = useClientFor(connectionId);
  const listRef = useRef<FlashListRef<PlacedItem>>(null);
  const historyInteraction = useRef<number | null>(null);
  const [headerHeight, setHeaderHeight] = useState<number>(insets.top + threadLayout.initialHeaderHeight);

  // The card's state as it is now, not as it was when this opened: the agent
  // is followed until its card says it ended.
  const reported = useDelegationStates((store) => store.states[followKey]);
  const state = reported ?? initialState;
  const found = useAgentPath(client, dirs, target, state === 'running');
  const transcript = useTranscript(db, client, connectionId, workspaceId, found.path, state === 'running');
  const scroll = useThreadScroll(listRef, transcript.historyVersion);

  // Every line of a subagent's transcript is a sidechain; here they are the conversation.
  const rows = useMemo(() => threadItems(transcript.messages, { showSidechain: true }), [transcript.messages]);

  // Its own subagents are filed under the main session's folder, not its own.
  const scope = useMemo<DelegationScope>(() => {
    const dir = found.path === null ? null : sessionDir(found.path);
    return { client, connectionId, workspaceId, sessionDirs: dir === null ? [] : [dir] };
  }, [client, connectionId, workspaceId, found.path]);

  const metaLine = found.meta === null
    ? subtitle
    : [found.meta.agentType, modelDisplayName(found.meta.model)].filter((part): part is string => part !== null).join(' · ');
  // Looked for and not there: starting while it runs, gone once it ended.
  const missing = found.missing || transcript.absent;

  return (
    <Screen presentation="edge-to-edge">
      <View testID="subagent-screen" style={{ flex: 1, width: '100%', maxWidth: size.contentMaxWidth, alignSelf: 'center' }}>
        {rows.length === 0 ? (
          <View style={{ flex: 1, paddingTop: headerHeight, justifyContent: 'center' }}>
            {missing && state === 'running' ? (
              <EmptyState symbol="cpu" title="Starting" body="This agent hasn't written anything yet. It shows here as soon as it does." />
            ) : missing ? (
              <EmptyState symbol="cpu" title="Not on this host" body="This agent's transcript isn't where Claude keeps it. It may have been cleaned up." />
            ) : (
              <ActivityIndicator color={colors.secondaryLabel} />
            )}
          </View>
        ) : (
          <DelegationScopeProvider value={scope}>
            <FlashList
              key={transcript.historyVersion}
              testID="subagent-messages"
              ref={listRef}
              data={rows}
              keyExtractor={(row) => row.item.key}
              getItemType={(row) => row.item.kind}
              contentContainerStyle={{ paddingHorizontal: screenPadding, paddingTop: spacing.sm }}
              scrollIndicatorInsets={{ top: headerHeight }}
              // As the thread's: the first frame at the end, and following it
              // after that is `useThreadScroll`'s alone.
              maintainVisibleContentPosition={{ startRenderingFromBottom: true }}
              {...scroll.listProps}
              onScroll={(event) => {
                scroll.listProps.onScroll(event);
                if (historyInteraction.current === transcript.historyVersion && scroll.nearTop()) void transcript.loadOlder();
              }}
              onScrollBeginDrag={() => {
                scroll.listProps.onScrollBeginDrag();
                historyInteraction.current = transcript.historyVersion;
                if (scroll.nearTop()) void transcript.loadOlder();
              }}
              ListHeaderComponent={<View />}
              ListHeaderComponentStyle={{ height: headerHeight }}
              scrollEventThrottle={64}
              renderItem={({ item: placed, index }) => (
                <View style={{ paddingTop: placed.startsTurn ? spacing.xl : spacing.sm }}>
                  {index === 0 && <OlderHistory loading={transcript.loadingOlder} reachedStart={transcript.reachedStart} />}
                  <ThreadRow placed={placed} />
                </View>
              )}
              ListFooterComponent={<View style={{ paddingBottom: insets.bottom + spacing.xl }} />}
            />
          </DelegationScopeProvider>
        )}
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + spacing.md }}>
          <JumpToBottom
            visible={scroll.awayFromEnd && rows.length > 0}
            unreadBelow={scroll.awayFromEnd && state === 'running'}
            onPress={() => scroll.followEnd(true)}
          />
        </View>
      </View>
      <ReadOnlyHeader
        testID="subagent"
        title={title}
        subtitle={metaLine}
        state={state}
        backLabel="Back"
        onBack={onBack}
        onHeight={setHeaderHeight}
        error={transcript.error}
      />
    </Screen>
  );
}
