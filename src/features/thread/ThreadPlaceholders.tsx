import { View } from 'react-native';

import { WaitingBar } from '@/components/Activity';
import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { spacing } from '@/theme/tokens';

/**
 * The two full-screen states a thread shows instead of its bubbles.
 *
 * Both are presentational: everything they know arrives as props, and neither
 * reads the transport, the database or a store. That is what lets them live
 * here rather than in the route, see CLAUDE.md on route thinness.
 */

/**
 * The chat whose host is no longer on the device.
 *
 * Every other empty state here is about something the host has not said yet.
 * This one is about there being no host to ask, so it offers the two places
 * worth going instead of a message field that cannot send.
 */
export function MissingHost({ onBack, onHosts }: { onBack?: () => void; onHosts: () => void }) {
  return (
    <View
      testID="thread-host-missing"
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.xxl,
        gap: spacing.sm,
      }}>
      <Text variant="title3" style={{ textAlign: 'center' }}>
        This chat&apos;s host is gone
      </Text>
      <Text variant="subhead" color="secondary" style={{ textAlign: 'center' }}>
        The connection this conversation belongs to isn&apos;t on this device any more, so there is
        nothing to read it from and nothing to send to.
      </Text>
      <View style={{ marginTop: spacing.sm, alignSelf: 'stretch', gap: spacing.sm }}>
        <Button title="Go to Hosts" onPress={onHosts} testID="thread-open-hosts" />
        {onBack !== undefined && <Button title="Back to chats" variant="tinted" onPress={onBack} testID="thread-host-back" />}
      </View>
    </View>
  );
}

/**
 * What the thread shows before its first batch of history arrives, and when a
 * workspace genuinely has no messages.
 *
 * Not a bare spinner: which of the two it is depends on whether the agent is
 * working, and telling someone "no messages yet" while their agent is mid-task
 * would be wrong.
 */
export function ThreadPlaceholder({
  waiting,
  loading,
  canSend,
  onBack,
  title,
  sessionState,
  agentKind = 'claude',
  onInstallIntegration,
  installing,
  installError,
}: {
  waiting: boolean;
  loading: boolean;
  canSend: boolean;
  onBack?: () => void;
  title: string;
  sessionState: 'ok' | 'waiting' | 'missing' | 'unsupported';
  agentKind?: 'claude' | 'codex';
  onInstallIntegration?: () => void;
  installing: boolean;
  installError: string | null;
}) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.xxl,
        gap: spacing.sm,
      }}>
      {loading ? (
        <>
          <WaitingBar />
          <Text variant="subhead" color="secondary">
            Loading the conversation…
          </Text>
        </>
      ) : sessionState === 'unsupported' ? (
        <>
          <Text variant="title3" style={{ textAlign: 'center' }}>Chat history is not supported for this agent</Text>
          <Text variant="subhead" color="secondary" style={{ textAlign: 'center' }}>
            HerdrChat can read Claude Code and Codex conversations. Open this agent in the host terminal to read its output.
          </Text>
        </>
      ) : sessionState === 'missing' ? (
        // The app cannot read a transcript it cannot identify, and it will not
        // guess, so this is the difference between a screen that looks broken
        // and one that tells you which command fixes it.
        <>
          <Text variant="title3" style={{ textAlign: 'center' }}>
            Can&apos;t identify this chat
          </Text>
          <Text variant="subhead" color="secondary" style={{ textAlign: 'center' }}>
            The agent isn&apos;t reporting which {agentKind === 'codex' ? 'Codex' : 'Claude'} session it is, so this thread can&apos;t be
            told apart from others in the same folder.
          </Text>
          <Text variant="footnote" color="secondary" style={{ textAlign: 'center' }}>
            Install the integration, then resume this same session on the host when the agent is idle.
            The integration reports at session start. Your running agent will not be restarted by this button.
            {agentKind === 'codex' ? ' This adds a Codex launcher in ~/.local/bin for future chats. In the current Codex chat, find its session id with /status. When idle, exit and run herdrchat-codex resume <session-id>. Review the Herdr hook in /hooks if prompted.' : ''}
          </Text>
          {onInstallIntegration !== undefined && (
            <View style={{ marginTop: spacing.sm, alignSelf: 'stretch' }}>
              <Button
                title={installing ? 'Installing\u2026' : 'Install it on the host'}
                onPress={onInstallIntegration}
                loading={installing}
                testID="install-integration"
              />
            </View>
          )}
          {installError !== null && (
            <Text variant="footnote" color="attention" style={{ textAlign: 'center' }}>
              {installError} Run{' '}
              <Text variant="footnote" mono color="attention">
                herdr integration install {agentKind}
              </Text>{' '}
              on the host instead.
            </Text>
          )}
        </>
      ) : sessionState === 'waiting' ? (
        <>
          <WaitingBar />
          <Text variant="subhead" color="secondary" style={{ textAlign: 'center' }}>
            Waiting for the agent to report its session…
          </Text>
          {agentKind === 'codex' && (
            <Text variant="footnote" color="secondary" style={{ textAlign: 'center' }}>
              For a new Codex chat, send your first message to start the session. For an existing chat, install the integration and resume the same session when idle.
            </Text>
          )}
        </>
      ) : !canSend ? (
        <>
          <Text variant="title3" style={{ textAlign: 'center' }}>
            No agent is running
          </Text>
          <Text variant="subhead" color="secondary" style={{ textAlign: 'center' }}>
            Start an agent on the host, or choose another conversation in Chats.
          </Text>
          {onBack !== undefined && <Button title="Back to chats" variant="tinted" onPress={onBack} />}
        </>
      ) : waiting ? (
        <>
          <WaitingBar />
          <Text variant="subhead" color="secondary">
            The agent is working. Its reply will appear here.
          </Text>
        </>
      ) : (
        <>
          <Text variant="title3">No messages yet</Text>
          <Text variant="subhead" color="secondary" style={{ textAlign: 'center' }}>
            Send your first message, {title} is ready.
          </Text>
        </>
      )}
    </View>
  );
}
