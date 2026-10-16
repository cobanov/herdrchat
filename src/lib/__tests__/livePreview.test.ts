import { readFileSync } from 'fs';
import { join } from 'path';

import { DEMO_GROK_WORKING_SCREEN, DEMO_WORKING_SCREEN } from '../demo/scenarios';
import { extractLivePreview } from '../transcript/livePreview';

const screen = (name: string) => readFileSync(join(__dirname, 'fixtures/screens', name), 'utf8');

/**
 * Reported from a phone: under the sent message, "✶ Propagating…" and
 * "✔ Update installed · Restart to update" showed as the agent's answer,
 * above the app's own "Writing…". Three working lines for one turn. The `·`
 * in Claude's update notice made it a status line, so the preview anchored
 * below the spinner and took the spinner and the notice for prose.
 */
it('shows neither the spinner nor the update notice as the answer', () => {
  expect(extractLivePreview(screen('claude-working-update.txt'))).toBeNull();
  // The Demo works under the same screen, for the UI flow (regression/thread).
  expect(extractLivePreview(DEMO_WORKING_SCREEN)).toBeNull();
});

// With the anchor on the spinner, the walk up meets the prompt the turn is
// answering. Past it is the previous turn, whose answer is not this one.
it('stops at the prompt rather than show the previous answer', () => {
  const answering = screen('claude-working-update.txt')
    .replace('✶ Propagating…', '⏺ It comes from the lint script in the studio repository.\n\n✶ Propagating…');
  expect(extractLivePreview(answering)).toBe('It comes from the lint script in the studio repository.');
});

// A tool call is not the answer either: its output line under it marks it.
it('shows nothing for a tool call above the spinner, past its tip', () => {
  expect(extractLivePreview(screen('claude-working-tool.txt'))).toBeNull();
});

it('takes the spinner, not a finished turn above it, as the anchor', () => {
  const lines = [
    '⏺ The earlier answer, which is finished and already in the transcript.',
    '',
    '✻ Worked for 1m 12s',
    '',
    '⏺ The answer this turn is writing, long enough to count as prose.',
    '',
    '✳ Thinking… (4s · ↓ 120 tokens)',
  ];
  expect(extractLivePreview(lines.join('\n'))).toBe('The answer this turn is writing, long enough to count as prose.');
  // The turn has just started and drawn no spinner yet: the finished turn's
  // line is chrome, and its answer is above the new prompt.
  const starting = [...lines.slice(0, 3), '', '❯ Now the next part', '', '─'.repeat(40), '❯', '─'.repeat(40), '  esc to interrupt'];
  expect(extractLivePreview(starting.join('\n'))).toBeNull();
});

/**
 * Found by the live run (scripts/e2e-live.sh): under a Grok reply, "⠋ Thinking…
 * 0.0s 2.6s ⇣1.46k [stop]" showed as the answer above the app's own "Writing…".
 * Grok's spinner is a braille glyph, which the anchor did not know. These are
 * Grok 4.7's screens, read with `herdr pane read`: waiting, writing with the
 * last line of a list in view, and writing with the reply scrolled away and
 * only the scrollbar beside the blank rows.
 */
it.each(['grok-waiting.txt', 'grok-responding.txt', 'grok-responding-scrolled.txt'])(
  'shows none of Grok\'s status line as the answer (%s)',
  (name) => {
    expect(extractLivePreview(screen(name))).toBeNull();
  }
);

// The Demo's Grok works under the same kind of screen (regression/grok).
it('shows nothing for the Demo\'s Grok at work', () => {
  expect(extractLivePreview(DEMO_GROK_WORKING_SCREEN)).toBeNull();
});

it('shows the prose above Grok\'s spinner', () => {
  const writing = screen('grok-responding-scrolled.txt').replace(
    '   ⠙ Responding…',
    '   A tide pool keeps its water when the sea falls back, so its animals stay wet.\n   ⠙ Responding…'
  );
  expect(extractLivePreview(writing)).toBe('A tide pool keeps its water when the sea falls back, so its animals stay wet.');
});
