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
 * here rather than in the route — see CLAUDE.md on route thinness.
 */

/**
 * The chat whose host is no longer on the device.
 *
 * Every other empty state here is about something the host has not said yet.
 * This one is about there being no host to ask, so it offers the two places
 * worth going instead of a message field that cannot send.
 */
export function MissingHost({ onBack, onHosts }: { onBack: () => void; onHosts: () => void }) {
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
        The connection this conversation belongs to isn&apos;t on this device any
        more, so there is nothing to read it from and nothing to send to.
      </Text>
      <View style={{ marginTop: spacing.sm, alignSelf: 'stretch', gap: spacing.sm }}>
        <Button title="Go to Hosts" onPress={onHosts} testID="thread-open-hosts" />
        <Button title="Back to chats" variant="tinted" onPress={onBack} testID="thread-host-back" />
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
  title,
  sessionState,
  onInstallIntegration,
  installing,
  installError,
}: {
  waiting: boolean;
  title: string;
  sessionState: 'ok' | 'waiting' | 'missing';
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
      {waiting ? (
        <>
          <WaitingBar />
          <Text variant="subhead" color="secondary">
            Loading the conversation…
          </Text>
        </>
      ) : sessionState === 'missing' ? (
        // The app cannot read a transcript it cannot identify, and it will not
        // guess — so this is the difference between a screen that looks broken
        // and one that tells you which command fixes it.
        <>
          <Text variant="title3" style={{ textAlign: 'center' }}>
            Can&apos;t identify this chat
          </Text>
          <Text variant="subhead" color="secondary" style={{ textAlign: 'center' }}>
            The agent isn&apos;t reporting which Claude session it is, so this
            thread can&apos;t be told apart from others in the same folder.
          </Text>
          <Text variant="footnote" color="secondary" style={{ textAlign: 'center' }}>
            Installing it takes a moment. This agent has to be restarted
            afterwards — the integration only reports at session start, so a
            session already running keeps saying nothing.
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
                herdr integration install claude
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
        </>
      ) : (
        <>
          <Text variant="title3">No messages yet</Text>
          <Text variant="subhead" color="secondary" style={{ textAlign: 'center' }}>
            Send your first message — {title} is ready.
          </Text>
        </>
      )}
    </View>
  );
}
