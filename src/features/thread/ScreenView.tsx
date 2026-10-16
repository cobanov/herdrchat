import { useRef } from 'react';
import { ScrollView } from 'react-native';

import { WaitingBar } from '@/components/Activity';
import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { screenPadding, spacing } from '@/theme/tokens';

/**
 * The chat of an agent whose history the app cannot read: its screen as the
 * host's terminal shows it now, under a line that says so. Monospace and set
 * apart from bubbles on purpose, so a terminal's text never passes for a
 * transcript. Kept at its end as it changes: it is a live screen, not history.
 *
 * An agent herdr has no integration for, but HerdrChat has a hook for (Gemini
 * CLI), is read once the hook reports its session: `onInstall` offers it.
 */
export function ScreenView({
  text,
  agent,
  topInset,
  bottomInset,
  onInstall,
  installing = false,
  installError = null,
}: {
  text: string | null;
  agent: string;
  topInset: number;
  bottomInset: number;
  onInstall?: () => void;
  installing?: boolean;
  installError?: string | null;
}) {
  const scroll = useRef<ScrollView>(null);
  return (
    <ScrollView
      ref={scroll}
      testID="agent-screen"
      scrollIndicatorInsets={{ top: topInset }}
      keyboardDismissMode="interactive"
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      contentContainerStyle={{
        paddingTop: topInset + spacing.md,
        paddingHorizontal: screenPadding,
        paddingBottom: bottomInset,
        gap: spacing.md,
      }}>
      <Text variant="footnote" color="secondary">
        {`HerdrChat can't read ${agent}'s history yet, so this is its terminal right now. Messages you send go to it.`}
      </Text>
      {onInstall !== undefined && (
        <>
          <Text variant="footnote" color="secondary">
            {`Install HerdrChat's hook for ${agent} on the host, then start ${agent} there again and resume this conversation. From then on it says which conversation it is, and this chat shows its history.`}
          </Text>
          <Button
            title={installing ? 'Installing\u2026' : 'Install it on the host'}
            onPress={onInstall}
            loading={installing}
            testID="install-integration"
          />
          {installError !== null && (
            <Text variant="footnote" color="attention">
              {installError}
            </Text>
          )}
        </>
      )}
      {text === null ? <WaitingBar /> : (
        <Text variant="footnote" mono selectable testID="agent-screen-text">
          {text}
        </Text>
      )}
    </ScrollView>
  );
}
