import { useRef } from 'react';
import { ScrollView, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { WaitingBar } from '@/components/Activity';
import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { scrollStep, type ScrollEvent, type ScrollMode } from '@/lib/threadScroll';
import { screenPadding, spacing, threadLayout } from '@/theme/tokens';

/**
 * The chat of an agent whose history the app cannot read: its screen as the
 * host's terminal shows it now, under a line that says so. Monospace and set
 * apart from bubbles on purpose, so a terminal's text never passes for a
 * transcript. Kept at its end as it changes, while the reader is there: it is
 * a live screen, but a reader who scrolled up (to the hook's install button
 * above it, on a real host) was pulled back down by every poll.
 *
 * An agent whose herdr integration would report its session is read once it
 * does: `onInstall` offers to install that integration.
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
  // The thread's rule: follow the end until the reader scrolls away from it.
  const mode = useRef<ScrollMode>('following');
  const step = (event: ScrollEvent) => {
    const next = scrollStep(mode.current, event, threadLayout.bottomSlack);
    mode.current = next.mode;
    if (next.toEnd) scroll.current?.scrollToEnd({ animated: false });
  };
  const readerScrolled = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => step({
    kind: 'readerScrolled',
    distanceFromEnd: nativeEvent.contentSize.height - nativeEvent.contentOffset.y - nativeEvent.layoutMeasurement.height,
  });
  return (
    <ScrollView
      ref={scroll}
      testID="agent-screen"
      scrollIndicatorInsets={{ top: topInset }}
      keyboardDismissMode="interactive"
      onScrollEndDrag={readerScrolled}
      onMomentumScrollEnd={readerScrolled}
      onContentSizeChange={() => step({ kind: 'resized' })}
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
            {`Install the ${agent} integration on the host, then start ${agent} there again and resume this conversation. From then on it says which conversation it is, and this chat shows its history.`}
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
