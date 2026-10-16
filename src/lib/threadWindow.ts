import { receiptKey, type ChatMessage } from './transcript/message';
import { continueWindow } from './transcript/window';

/**
 * The messages one open thread shows, apart from React.
 *
 * Transcript arrivals and optimistic echoes are kept apart so an unconfirmed
 * echo can sit at its send position rather than pinning to the bottom below
 * newer messages. `view` merges them, and confirms each echo a new transcript
 * line answers.
 */
export class ThreadWindow {
  private arrivals: ChatMessage[] = [];
  private echoes: ChatMessage[] = [];
  /** Per echo, the arrivals there were when it was sent. Only a newer one confirms it. */
  private readonly baselines = new Map<string, Set<string>>();
  private readonly claimedReceipts = new Set<string>();
  private readonly confirmedEchoes = new Set<string>();
  /**
   * What is on screen, for dedupe. Not every cached row ever seen: otherwise
   * scroll-up could never recover cached-but-unmounted turns.
   */
  private seen = new Set<string>();

  get isEmpty(): boolean {
    return this.arrivals.length === 0;
  }

  /** Show exactly these arrivals: the cache on open, or a reset. Echoes stay. */
  seed(messages: ChatMessage[]): void {
    this.arrivals = messages;
    this.seen = new Set(messages.map((message) => message.id));
  }

  /**
   * Add what is new of `incoming` at the end. A message already shown that
   * comes again changed replaces the one shown, where it is: Gemini CLI writes
   * a message again under its id once its tool results and tokens are in.
   * Returns what changed, each message once, as it now is.
   */
  append(incoming: readonly ChatMessage[]): ChatMessage[] {
    const changed = new Map<string, ChatMessage>();
    for (const message of incoming) {
      if (this.seen.has(message.id)) {
        const index = this.arrivals.findIndex((shown) => shown.id === message.id);
        // Every other reader repeats a line only as it was: nothing to redo.
        if (index < 0 || JSON.stringify(this.arrivals[index]) === JSON.stringify(message)) continue;
        this.arrivals[index] = message;
      } else {
        this.seen.add(message.id);
        this.arrivals.push(message);
      }
      changed.set(message.id, message);
    }
    return [...changed.values()];
  }

  /**
   * Put what is new of a page of older history above the rest. Returns the
   * new part. A message already shown is a later version of it: it stays.
   */
  prepend(older: readonly ChatMessage[]): ChatMessage[] {
    const fresh = this.unseen(older);
    this.arrivals.unshift(...fresh);
    return fresh;
  }

  /**
   * Show a fresh read of the transcript's end (`continueWindow`). When it
   * continues what is on screen, the older history the reader paged back to
   * stays (`keptOlder`); when it cannot (`continued` false), it is a new list.
   */
  replaceEnd(latest: ChatMessage[]): { continued: boolean; keptOlder: boolean } {
    const continued = continueWindow(this.arrivals, latest);
    this.arrivals = continued ?? latest;
    this.seen = new Set(this.arrivals.map((message) => message.id));
    return { continued: continued !== null, keptOlder: continued !== null && continued.length > latest.length };
  }

  addEcho(echo: ChatMessage): void {
    this.baselines.set(echo.id, new Set(this.arrivals.map((message) => message.id)));
    this.echoes.push(echo);
  }

  /** An unconfirmed echo, for a retry. */
  echo(id: string): ChatMessage | undefined {
    return this.echoes.find((message) => message.id === id);
  }

  isConfirmed(echoId: string): boolean {
    return this.confirmedEchoes.has(echoId);
  }

  reset(): void {
    this.arrivals = [];
    this.echoes = [];
    this.baselines.clear();
    this.claimedReceipts.clear();
    this.confirmedEchoes.clear();
    this.seen = new Set();
  }

  /**
   * The list to show, after confirming each echo a new transcript line
   * answers. `confirmed` counts the echoes this call confirmed.
   *
   * Only a NEW host record can acknowledge a prompt. Matching all historical
   * text made a second "again" disappear before it had even been sent.
   */
  view(): { messages: ChatMessage[]; confirmed: number } {
    const before = this.echoes.length;
    this.echoes = this.echoes.filter((echo) => {
      const baseline = this.baselines.get(echo.id);
      const receipt = this.arrivals.find((message) => message.role === 'user' &&
        !baseline?.has(message.id) && !this.claimedReceipts.has(message.id) &&
        receiptKey(message) === receiptKey(echo));
      if (receipt === undefined) return true;
      this.claimedReceipts.add(receipt.id);
      this.confirmedEchoes.add(echo.id);
      this.baselines.delete(echo.id);
      return false;
    });
    const confirmed = before - this.echoes.length;
    if (this.echoes.length === 0) return { messages: [...this.arrivals], confirmed };

    // Merge the two time-ordered lists, carrying the last known timestamp
    // forward for arrivals that have none.
    const merged: ChatMessage[] = [];
    const pending = [...this.echoes].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    let index = 0;
    let last = 0;
    for (const message of this.arrivals) {
      const effective = message.timestamp ?? last;
      last = effective;
      while (index < pending.length && (pending[index]?.timestamp ?? Infinity) <= effective) {
        merged.push(pending[index]!);
        index += 1;
      }
      merged.push(message);
    }
    merged.push(...pending.slice(index));
    return { messages: merged, confirmed };
  }

  private unseen(incoming: readonly ChatMessage[]): ChatMessage[] {
    const fresh = incoming.filter((message) => !this.seen.has(message.id));
    for (const message of fresh) this.seen.add(message.id);
    return fresh;
  }
}
