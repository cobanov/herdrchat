import { threadItems, type Delegation } from '../threadItems';
import { parseTranscript } from '../transcript/parser';

/**
 * Where one delegated call stands, from the lines of the transcript it was
 * made in that name it (`delegationLinesCommand`): the same reading the card
 * in the thread makes, so the two never disagree. Null when the call's own
 * line is not among them (the wrong transcript, or a torn read).
 *
 * Read as sidechain lines too: a nested agent's call is in its parent
 * subagent's transcript, every line of which is one.
 */
export function delegationFromLines(text: string, toolUseId: string): Delegation | null {
  const placed = threadItems(parseTranscript(text), { showSidechain: true });
  for (const { item } of placed) {
    if ((item.kind === 'subagent' || item.kind === 'workflow') && item.call.id === toolUseId) return item.delegation;
  }
  return null;
}
