import { Text } from '@/components/Text';

/**
 * The answer the agent is writing right now, scraped from the pane's visible
 * screen, set in the thread where the reply will land.
 *
 * Dimmer than a real reply on purpose: this is a best-effort read of a
 * terminal, not a transcript turn, and the real text replaces it once the
 * turn settles. Looking identical would turn every scraping mistake into an
 * apparent statement by the agent. The working line under it says "Writing…".
 */
export function LivePreviewBubble({ text }: { text: string }) {
  return (
    <Text variant="body" color="secondary" testID="live-preview">
      {text}
    </Text>
  );
}
