import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TypingDots } from '@/components/Activity';
import { EdgeFade, Glass } from '@/components/Glass';
import { Icon } from '@/components/Icon';
import { haptics } from '@/components/haptics';
import { Text } from '@/components/Text';
import { StopButton } from '@/features/thread/StopButton';
import type { ThreadState } from '@/features/thread/useThread';
import { chatTitle, sameName } from '@/lib/chatTitle';
import { agentName, type AgentStatus } from '@/lib/herdr/models';
import { modelDisplayName, type settingsFromNotes } from '@/lib/transcript/sessionMeta';
import { useTheme } from '@/theme/ThemeProvider';
import { glass, minTouchTarget, radius, screenPadding, size, spacing } from '@/theme/tokens';

/**
 * The thread's header: back, the chat's title over its line of detail and
 * status, the terminal, the tool toggle, and stop or reload. `children` are
 * the banners under it.
 *
 * It floats over the list and is rendered after it, so native blur samples
 * the scrolling content. The material reaches the screen edge; only the
 * controls take insets.
 */
export function ThreadHeader({
  heading, subtitle, status, dimmed, statusText, onBack, onTerminal, onStop, onReload, onHeight, children,
}: {
  heading: string;
  subtitle: string;
  status: AgentStatus;
  /** Offline or reconnecting: the dot does not claim the agent's state. */
  dimmed: boolean;
  statusText: string | null;
  onBack?: () => void;
  /** Absent: no terminal can open here. */
  onTerminal?: () => void;
  onStop: (hard: boolean) => void;
  onReload: () => void;
  onHeight: (height: number) => void;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const tone = status === 'blocked' ? 'attention' : 'secondary';
  return (
    <View
      testID="thread-header-overlay"
      pointerEvents="box-none"
      onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
      style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
      {/* No bar: the conversation scrolls up under the controls and blurs
          into the page (EdgeFade), the way a document's top edge does. The
          extra room below the controls is the fade's own tail. */}
      <View testID="thread-header" style={{ paddingBottom: glass.edgeTail }}>
        <EdgeFade />
        <SafeAreaView testID="thread-header-safe-area" edges={['top', 'left', 'right']}>
          <View style={{ width: '100%', maxWidth: size.contentMaxWidth, alignSelf: 'center' }}>
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingHorizontal: screenPadding,
              paddingVertical: spacing.sm,
            }}>
              {onBack !== undefined && (
                <Glass interactive style={{ borderRadius: radius.full, overflow: 'hidden' }}>
                  <Pressable
                    onPress={onBack}
                    accessibilityRole="button"
                    accessibilityLabel="Back to chats"
                    testID="thread-back"
                    style={{ width: minTouchTarget, height: minTouchTarget, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="chevron.left" size={20} tintColor={colors.label} fallback={<Text>‹</Text>} />
                  </Pressable>
                </Glass>
              )}
              <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
                <Text testID="thread-title" variant="headline" numberOfLines={1}>
                  {heading}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  <View style={{ width: size.statusDot, height: size.statusDot, borderRadius: radius.full, backgroundColor: dimmed ? colors.secondaryLabel : statusColor(status, colors) }} />
                  {subtitle.length > 0 && (
                    <Text testID="thread-meta" variant="caption" color={tone} style={{ flexShrink: 1 }} numberOfLines={1}>
                      {subtitle}
                    </Text>
                  )}
                  {/*
                    The connection before the agent, in its own text after the
                    line, which never shrinks: at the end of one truncated line
                    it was the first word cut, and a host's name in front
                    made that the usual case, leaving the dot's colour as the
                    only status on a phone.
                  */}
                  <Text testID="thread-status" variant="caption" color={tone} style={{ flexShrink: 0 }} numberOfLines={1}>
                    {subtitle.length > 0 ? `· ${statusText}` : statusText}
                  </Text>
                  {status === 'working' && <TypingDots size={3.5} />}
                </View>
              </View>
              {/* The agent's own screen, for what the chat cannot show:
                  a panel it does not know, a login prompt, a TUI. */}
              {onTerminal !== undefined && (
                <Glass interactive style={{ borderRadius: radius.full, overflow: 'hidden' }}>
                  <Pressable
                    onPress={() => {
                      haptics.selection();
                      onTerminal();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Terminal"
                    testID="thread-terminal"
                    style={{ width: minTouchTarget, height: minTouchTarget, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="terminal" size={size.headerGlyph} tintColor={colors.label} fallback={<Text>{'>_'}</Text>} />
                  </Pressable>
                </Glass>
              )}
              <Glass interactive style={{ borderRadius: radius.full, overflow: 'hidden' }}>
                {status === 'working' ? (
                  <StopButton onStop={onStop} />
                ) : (
                  <Pressable
                    onPress={() => {
                      haptics.light();
                      onReload();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Reload this conversation"
                    testID="thread-reload"
                    style={{ width: minTouchTarget, height: minTouchTarget, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="arrow.clockwise" size={size.headerGlyph} tintColor={colors.label} fallback={<Text>↻</Text>} />
                  </Pressable>
                )}
              </Glass>
            </View>
            {children}
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
}

/**
 * What the header says: the chat's name, and the line of detail under it.
 *
 * The name is its session's title, as the row has it (`chatTitle`). What the
 * host says now wins over what the link carried (`title`), which may be stale
 * after a rename or a retitle; the link's is shown only until the first poll
 * lands. Without either, 'Chat' rather than an internal id like 'w7' (#113).
 *
 * A chat titled by its session names its workspace in the line instead,
 * first, as its row's line does. One agent of several also says which agent
 * it is, after the workspace. Both read from the agents the poll bound, so
 * they wait for the first poll rather than guessing.
 */
export function threadHeading(
  thread: Pick<ThreadState, 'sessionTitle' | 'agentName' | 'workspaceLabel' | 'agents' | 'sessionMeta' | 'workingDirName'>,
  { title, paneId, hostLabel, commanded }: {
    title: string | undefined;
    paneId: string | undefined;
    /** The host's name, when it is not the selected host. */
    hostLabel: string | null;
    /** A /model or /effort that has just run, which wins over the last reply's. */
    commanded: ReturnType<typeof settingsFromNotes>;
  }
): { heading: string; subtitle: string } {
  const polledTitle = chatTitle({
    sessionTitle: thread.sessionTitle,
    agentName: thread.agentName,
    workspaceLabel: thread.workspaceLabel,
    workspaceId: null,
    // One agent's chat of a workspace running several is titled by its session;
    // a name someone gave the workspace titles the workspace's own chat (`rowTitle`).
    folders: paneId === undefined || paneId === '' ? thread.agents.map((agent) => agent.cwd) : undefined,
  });
  const linkTitle = title?.trim() ?? '';
  const effort = commanded.effort ?? thread.sessionMeta?.effort ?? null;
  const paneAgent = paneId === undefined || paneId === '' ? undefined : thread.agents[0];
  const workspaceLine = thread.workspaceLabel !== null && !sameName(polledTitle, thread.workspaceLabel) ? thread.workspaceLabel : null;
  const subtitle = [
    // The host first: the same folder on two computers is two chats.
    hostLabel,
    workspaceLine,
    paneAgent === undefined ? null : agentName(paneAgent.agent),
    commanded.model ?? modelDisplayName(thread.sessionMeta?.model ?? null),
    // "high effort", not a bare "high" that could be anything.
    effort === null ? null : `${effort} effort`,
    // The folder, unless it is the workspace's own name already said first:
    // the line is one line, and the less said the less of it is cut.
    sameName(workspaceLine, thread.workingDirName) ? null : thread.workingDirName,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
  return { heading: polledTitle !== '' ? polledTitle : linkTitle !== '' ? linkTitle : 'Chat', subtitle };
}

/**
 * The word after the header's line. The connection before the agent: "online"
 * under a banner saying the chat is offline or paused contradicted it (#4
 * acceptance).
 */
export function statusText(status: AgentStatus, offline: boolean, paused: boolean): string | null {
  if (offline) return 'offline';
  if (paused) return 'reconnecting';
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

function statusColor(status: AgentStatus, colors: ReturnType<typeof useTheme>['colors']): string {
  if (status === 'blocked') return colors.attention;
  if (status === 'working' || status === 'done') return colors.tint;
  return colors.tertiaryLabel;
}
