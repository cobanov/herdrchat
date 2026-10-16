import { useCallback, useRef, useState, type RefObject } from 'react';

import { uploadImage, type OutgoingImage } from '@/lib/attachments/upload';
import type { HerdrClient } from '@/lib/herdr/client';
import { sendTarget, type AgentInfo } from '@/lib/herdr/models';
import { errorText, HerdrError } from '@/lib/herdr/protocol';
import { SEND_TIMEOUT_MS } from '@/lib/herdr/timeouts';
import { isCatalogueAgent, isSlashCommand } from '@/lib/slashCommands';
import type { ThreadWindow } from '@/lib/threadWindow';
import { promptWithImages } from '@/lib/transcript/images';
import { displayText, ECHO_ID_PREFIX, imagePaths, type ChatMessage, type MessageSegment } from '@/lib/transcript/message';

import { chatAgents } from './useAgentPoll';
import type { SessionState } from './useSessionBinding';

const CODEX_RECEIPT_WAIT_MS = 5_000;
/** How long a send cut off by the connection waits for its transcript receipt. */
const TRANSPORT_RECEIPT_WAIT_MS = 8_000;
const RECEIPT_CHECK_MS = 100;
/**
 * How long a command may show nothing at all before its bubble says so. It
 * counts as run on a transcript line, a panel, or the agent starting to work.
 */
const COMMAND_CONFIRM_MS = 10_000;
/** States that prove the agent read a prompt: it started, or it stopped to ask. */
const REACTED = ['working', 'blocked'] as const;

const CODEX_DELIVERY_NOTICE = 'The input was sent to Codex, but its transcript has not confirmed delivery. Check the host before retrying.';
const STALLED_WARNING = 'The agent never picked that up, it may be stuck at a prompt. Try again.';
const UNCONFIRMED_WARNING = "Couldn't confirm delivery, the message may be stuck in the terminal. Try again.";
const DELIVERY_UNKNOWN_WARNING =
  "The connection dropped while sending, so the message may have arrived. Check the chat before sending it again.";
const COMMAND_UNCONFIRMED_WARNING = "Couldn't see that command run. Check the terminal before sending it again.";
/** Warnings about whether a message landed. Its transcript receipt answers them. */
const DELIVERY_WARNINGS: ReadonlySet<string> = new Set([
  CODEX_DELIVERY_NOTICE,
  STALLED_WARNING,
  UNCONFIRMED_WARNING,
  DELIVERY_UNKNOWN_WARNING,
  COMMAND_UNCONFIRMED_WARNING,
]);

/** An error once a message has arrived after all: a warning about its delivery is moot. */
export function withoutDeliveryWarning(previous: string | null): string | null {
  return previous !== null && DELIVERY_WARNINGS.has(previous) ? null : previous;
}

interface Options {
  client: HerdrClient | null;
  workspaceId: string;
  pane: string | undefined;
  aliveRef: RefObject<boolean>;
  boundSigRef: RefObject<string | null>;
  kickRef: RefObject<() => void>;
  setActionError: (error: string | null) => void;
  agents: readonly AgentInfo[];
  primaryPane: AgentInfo | null;
  loading: boolean;
  sessionState: SessionState;
  shown: ThreadWindow;
  rebuild: () => void;
  markFailed: (id: string) => void;
  unmarkFailed: (id: string) => void;
  watchOverlay: (paneId: string) => void;
  overlaySeen: () => number;
}

/** A message from the composer to the agent, the echo that shows it, and whether it landed. */
export function useDelivery({
  client, workspaceId, pane, aliveRef, boundSigRef, kickRef, setActionError, agents, primaryPane, loading, sessionState,
  shown, rebuild, markFailed, unmarkFailed, watchOverlay, overlaySeen,
}: Options) {
  const [isSending, setIsSending] = useState(false);
  const sending = useRef(false);
  /** Retries in flight, by echo id. A second tap on "retry" sent it twice (#100). */
  const retrying = useRef(new Set<string>());

  /**
   * The pane to send to, re-read at the moment of sending.
   *
   * `primaryPane` comes from the poll, so by the time someone taps send it can
   * be two seconds old. A pane id that has changed in that window, an agent
   * restarted, a layout redrawn, sends the message somewhere it will not be
   * read, and `pane run` succeeds against whatever is there, so the failure is
   * silent. This is the same trap the Raycast extension's reviewers caught in
   * its split targeting: don't act on an id you sampled a moment ago.
   *
   * Falls back to the polled pane if the check itself fails. A send that might
   * go to a stale pane still beats a send that does not happen.
   */
  const currentPane = useCallback(
    async (fallback: AgentInfo): Promise<AgentInfo> => {
      if (client === null) return fallback;
      try {
        const snapshot = await client.snapshot();
        const live = chatAgents(snapshot.agents, workspaceId, pane);
        return sendTarget(live) ?? live[0] ?? fallback;
      } catch {
        return fallback;
      }
    },
    [client, workspaceId, pane]
  );

  /**
   * Submit, and let the host verify wherever it can.
   *
   * `agent prompt --wait` makes herdr watch its own agent and answer with what
   * it saw. Its help: "when submission starts from a non-working state, --wait
   * first requires an observed state change within 5000ms; otherwise it returns
   * agent_prompt_stalled." That named error is exactly the stuck-in-the-composer
   * case the blind Enter was written to guess at, observed by the process that
   * owns the terminal, rather than inferred here from a fixed sleep.
   *
   * So on a modern host there are two outcomes and neither needs us to guess:
   * `delivered` returns immediately, `stalled` fails the bubble honestly.
   *
   * `unverified` is the legacy path, for hosts with no `agent prompt` (and the
   * fork's `written_to_pty`). There `pane run` only means keystrokes were sent,
   * so the old dance survives, including the second Enter, which is unsafe in
   * principle (if the first send DID land it submits an empty line into a live
   * agent) but is also the only thing that recovers a stuck composer on a host
   * with no alternative. It is narrowed to the one case it is for: the agent
   * still sitting idle. An agent that went `blocked` read the prompt and opened
   * a menu, and Enter there picks the highlighted option, usually "Yes", which
   * approved a tool call nobody saw (#76). So the wait accepts `blocked` as a
   * reaction, and the status is read again right before any Enter.
   *
   * `wasWorking` still guards all of it, and herdr's own caveat is why: --wait
   * "does not track turns: if the agent is already working, that active turn's
   * completion may match." Sending into a busy agent just queues, so there is
   * nothing to wait for and waiting would match the wrong turn.
   */
  const deliver = useCallback(
    async (text: string, echoId: string, polled: AgentInfo) => {
      if (client === null) return;
      // What the pane is doing right now. `idle` only when the host positively
      // says so; a failed read or a vanished pane is `unknown`, never `idle`.
      const paneState = async (paneId: string): Promise<'idle' | 'reacted' | 'unknown'> => {
        try {
          const snapshot = await client.snapshot();
          const status = snapshot.agents.find((agent) => agent.paneId === paneId)?.agentStatus;
          if (status === 'idle' || status === 'done') return 'idle';
          if (status === 'working' || status === 'blocked') return 'reacted';
          return 'unknown';
        } catch {
          return 'unknown';
        }
      };
      const deliverySig = boundSigRef.current;
      const current = () => aliveRef.current && deliverySig === boundSigRef.current;
      const confirmed = () => shown.isConfirmed(echoId);
      // Wait for the transcript to show the message. When it doesn't, the
      // bubble fails with `notice`, which says the message may have landed:
      // never a blind retry, never a second Enter.
      const awaitReceipt = async (notice: string, waitMs: number) => {
        const deadline = Date.now() + waitMs;
        while (current() && !confirmed() && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, RECEIPT_CHECK_MS));
        }
        if (current() && !confirmed()) {
          markFailed(echoId);
          setActionError(notice);
        }
      };
      const awaitCodexReceipt = () => awaitReceipt(CODEX_DELIVERY_NOTICE, CODEX_RECEIPT_WAIT_MS);
      setIsSending(true);
      try {
        const target = await currentPane(polled);

        if (isCatalogueAgent(target.agent) && isSlashCommand(text)) {
          // Never `sendPrompt` and never a second Enter: see `sendCommand`.
          const sentAt = Date.now();
          await client.sendCommand(target.paneId, text);
          if (!current()) return;
          watchOverlay(target.paneId);
          // Codex and Grok write nothing to their transcripts for a command,
          // so there is no receipt to wait for and silence proves nothing;
          // Codex's panels still show when they open.
          if (target.agent !== 'claude') return;
          const ran = () => confirmed() || overlaySeen() >= sentAt;
          while (current() && !ran() && Date.now() - sentAt < COMMAND_CONFIRM_MS) {
            await new Promise(resolve => setTimeout(resolve, RECEIPT_CHECK_MS));
          }
          if (!current() || ran() || (await paneState(target.paneId)) === 'reacted') return;
          markFailed(echoId);
          setActionError(COMMAND_UNCONFIRMED_WARNING);
          return;
        }

        const wasWorking = target.agentStatus === 'working';
        const outcome = await client.sendPrompt(target.paneId, text);
        if (!current() || confirmed()) return;

        if (target.agent === 'codex' && outcome !== 'delivered') {
          // Shared-service Codex TUIs may expose no observable composer state.
          // The native transcript is stronger evidence than an idle PTY, and
          // another Enter could submit twice. Wait for that receipt, never resend.
          await awaitCodexReceipt();
          return;
        }

        if (outcome === 'stalled') {
          // The host watched and nothing moved. No guessing, no second Enter.
          markFailed(echoId);
          setActionError(STALLED_WARNING);
          return;
        }

        if (outcome === 'unverified' && !wasWorking) {
          let accepted = await client.waitAgentStatus(target.paneId, REACTED, 3500);
          if (!accepted) {
            // Enter only into a composer the host says is idle. It may have
            // reacted just after the wait gave up; if its state is unknown, an
            // Enter is not safe to guess and the bubble says so instead.
            const state = await paneState(target.paneId);
            if (state === 'idle') {
              await client.sendKeys(target.paneId, ['Enter']);
              accepted = await client.waitAgentStatus(target.paneId, REACTED, 2500);
            } else {
              accepted = state === 'reacted';
            }
          }
          if (!accepted) {
            markFailed(echoId);
            setActionError(UNCONFIRMED_WARNING);
          }
        }
      } catch (thrown) {
        if (!current() || confirmed()) return;
        if (polled.agent === 'codex' && thrown instanceof HerdrError &&
            thrown.code === 'agent_prompt_unverifiable') {
          await awaitCodexReceipt();
          return;
        }
        if (thrown instanceof HerdrError && thrown.transport) {
          // The connection failed mid-send: the prompt may well have landed.
          // Reporting it as not delivered is how a retry sent it twice (#83).
          await awaitReceipt(DELIVERY_UNKNOWN_WARNING, TRANSPORT_RECEIPT_WAIT_MS);
          return;
        }
        markFailed(echoId);
        setActionError(errorText(thrown));
      } finally {
        setIsSending(false);
      }
    },
    [client, currentPane, watchOverlay, overlaySeen, shown, markFailed, setActionError, aliveRef, boundSigRef]
  );

  /**
   * Send to an agent whose history the app cannot read. herdr's prompt call
   * says whether the agent picked it up; a stall is said, never resent, and
   * the screen the next poll reads shows the rest.
   */
  const sendToScreen = useCallback(
    async (text: string, polled: AgentInfo) => {
      if (client === null) return;
      setIsSending(true);
      try {
        const target = await currentPane(polled);
        if ((await client.sendPrompt(target.paneId, text)) === 'stalled') setActionError(STALLED_WARNING);
      } catch (thrown) {
        setActionError(errorText(thrown));
      } finally {
        setIsSending(false);
        kickRef.current();
      }
    },
    [client, currentPane, setActionError, kickRef]
  );

  const send = useCallback(
    async (raw: string, images: readonly OutgoingImage[] = []): Promise<boolean> => {
      const text = raw.trim();
      if (
        (text.length === 0 && images.length === 0) ||
        primaryPane === null ||
        sending.current ||
        loading ||
        sessionState === 'replaced' ||
        (images.length > 0 && client === null)
      ) {
        return false;
      }
      sending.current = true;
      // A new message is a new attempt; the last one's warning has done its job.
      setActionError(null);
      try {
        // Pictures go to the host before the prompt that names them. One that
        // cannot be written stops the send: better the draft back than a
        // message pointing at a file that is not there.
        const paths: string[] = [];
        if (images.length > 0 && client !== null) {
          setIsSending(true);
          try {
            for (const image of images) {
              const uploaded = await uploadImage(client.transport, image, SEND_TIMEOUT_MS);
              if (!uploaded.ok) {
                setActionError(`Couldn't send the picture: ${uploaded.message}`);
                return false;
              }
              paths.push(uploaded.path);
            }
          } finally {
            setIsSending(false);
          }
        }
        if (sessionState === 'unsupported') {
          // No transcript will confirm an echo, so none is shown: the
          // message lands on the agent's screen, which the next poll reads.
          await sendToScreen(promptWithImages(text, paths), primaryPane);
          return true;
        }
        const segments: MessageSegment[] = [
          ...(text.length > 0 ? [{ kind: 'text' as const, text }] : []),
          ...paths.map((path) => ({ kind: 'image' as const, path })),
        ];
        const echo: ChatMessage = {
          id: `${ECHO_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`,
          role: 'user',
          segments,
          timestamp: Date.now(),
          agentLabel: null,
          isSidechain: false,
        };
        shown.addEcho(echo);
        rebuild();
        await deliver(promptWithImages(text, paths), echo.id, primaryPane);
        return true;
      } finally {
        sending.current = false;
      }
    },
    [primaryPane, rebuild, deliver, sendToScreen, loading, sessionState, client, shown, setActionError]
  );

  const retry = useCallback(
    async (id: string) => {
      const echo = shown.echo(id);
      if (echo === undefined || primaryPane === null || retrying.current.has(id)) return;
      retrying.current.add(id);
      unmarkFailed(id);
      try {
        // The pictures are already on the host; only the prompt goes again.
        await deliver(promptWithImages(displayText(echo), imagePaths(echo)), id, primaryPane);
      } finally {
        retrying.current.delete(id);
      }
    },
    [primaryPane, deliver, shown, unmarkFailed]
  );

  /**
   * Stop the agent. `hard` sends Ctrl-C, which can end the session.
   *
   * Targets the working pane specifically rather than `blockedPane ??
   * primaryPane` the way `sendKeys` does: a blocked agent is already stopped and
   * waiting for an answer, so interrupting it would answer nothing and might
   * dismiss the prompt the user is about to read.
   */
  const interrupt = useCallback(
    async (hard = false) => {
      const target = agents.find((a) => a.agentStatus === 'working') ?? primaryPane;
      if (client === null || target === null) return;
      try {
        await (hard ? client.interruptHard(target.paneId) : client.interrupt(target.paneId));
      } catch (thrown) {
        setActionError(errorText(thrown));
      }
    },
    [client, agents, primaryPane, setActionError]
  );

  return { isSending, send, retry, interrupt };
}
