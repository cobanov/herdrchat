import { useCallback, useRef, useState, type RefObject } from 'react';

import { agentSpec } from '@/lib/herdr/agents';
import type { HerdrClient } from '@/lib/herdr/client';
import type { AgentInfo } from '@/lib/herdr/models';
import { errorText } from '@/lib/herdr/protocol';
import { STATUS_POLL_MS } from '@/lib/poll';
import {
  blockedPromptSignature,
  blockedPendingTimeout,
  isMentionPopup,
  parseBlockedPrompt,
  resolveBlockedPending,
  type BlockedPending,
  type BlockedPrompt,
} from '@/lib/transcript/blockedPrompt';
import { parsePaneOverlay } from '@/lib/transcript/paneOverlay';


const BLOCKED_PENDING_ERROR = 'The reply may not have landed, check the agent.';
/** When to look at a blocked pane again after answering it. */
const ANSWER_LOOKS_MS = [400, 1_200] as const;

interface Options {
  client: HerdrClient | null;
  aliveRef: RefObject<boolean>;
  kickRef: RefObject<() => void>;
  setActionError: (error: string | null) => void;
  pollScale: number;
  agents: readonly AgentInfo[];
  primaryPane: AgentInfo | null;
}

/** A question an agent has open, read off its screen, and the reply to it. */
export function useBlockedPrompt({ client, aliveRef, kickRef, setActionError, pollScale, agents, primaryPane }: Options) {
  const [blockedPrompt, setBlockedPrompt] = useState<BlockedPrompt | null>(null);
  /** The pane with a question open, `blocked` or an idle one with input pending. */
  const [askingPaneId, setAskingPaneId] = useState<string | null>(null);
  /** The blocked-prompt reply in flight, if any. Non-null disables the bar. */
  const [blockedPending, setBlockedPending] = useState<BlockedPending | null>(null);
  // Mirrors the state for the poll closure and for the synchronous double-tap
  // guard in sendKeys, a second tap can land before React re-renders.
  const blockedPendingRef = useRef<BlockedPending | null>(null);
  const blockedPendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const blockedPane =
    agents.find((a) => a.agentStatus === 'blocked') ??
    agents.find((a) => a.paneId === askingPaneId) ??
    null;

  const clearBlockedPending = useCallback(() => {
    if (blockedPendingTimer.current !== null) {
      clearTimeout(blockedPendingTimer.current);
      blockedPendingTimer.current = null;
    }
    blockedPendingRef.current = null;
    setBlockedPending(null);
  }, []);

  /**
   * The poll's read of the question on screen. Returns the agent asking, if
   * any, and whether an idle agent's pending input is a slash command's panel
   * instead, which the overlay reads.
   */
  const readQuestion = useCallback(async (
    live: readonly AgentInfo[],
    visible: (paneId: string, lines: number) => Promise<string>
  ): Promise<{ blocked: AgentInfo | undefined; panel: boolean }> => {
    let blocked = live.find((agent) => agent.agentStatus === 'blocked');
    let parsedPrompt: BlockedPrompt | null = null;
    let panel = false;
    // herdr sees a menu waiting for keys while it still calls the agent
    // idle. A slash command's panel is one (the overlay path reads it);
    // anything else that parses as a question is answered like a blocked
    // agent's. Claude's folder-trust question on a first start is the case:
    // it refuses every prompt until answered, and nothing else on the phone
    // could answer it.
    const pendingInput = blocked === undefined
      ? live.find((agent) => agent.inputPending && agent.agentStatus !== 'working')
      : undefined;
    if (pendingInput !== undefined) {
      const raw = await visible(pendingInput.paneId, 40);
      if (parsePaneOverlay(raw) !== null) {
        panel = true;
      } else {
        const parsed = parseBlockedPrompt(raw);
        if (parsed.options.length > 0) {
          blocked = pendingInput;
          parsedPrompt = { ...parsed, submitWithEnter: agentSpec(pendingInput.agent)?.digitAnswers !== true };
        }
      }
    } else if (blocked !== undefined) {
      const raw = await visible(blocked.paneId, 40);
      if (blocked.agent === 'codex' && isMentionPopup(raw)) {
        parsedPrompt = {
          question: 'Codex has its file picker open. Close it here, or pick a file in the terminal.',
          options: [],
          dismissOnly: true,
        };
      } else {
        const parsed = parseBlockedPrompt(raw);
        // Claude answers on the digit alone; see `optionKeys`.
        parsedPrompt = parsed.options.length === 0
          ? null
          : { ...parsed, submitWithEnter: agentSpec(blocked.agent)?.digitAnswers !== true };
      }
    }
    // The same question as last poll keeps its object, as the agents do.
    setBlockedPrompt((previous) => (JSON.stringify(previous) === JSON.stringify(parsedPrompt) ? previous : parsedPrompt));
    setAskingPaneId(blocked?.paneId ?? null);

    // A reply in flight is confirmed (or orphaned) by what this poll saw.
    // Only the silent outcomes are handled here: the timeout banner belongs
    // to the timer in sendKeys, which raises it as an action error.
    const pending = blockedPendingRef.current;
    if (pending !== null) {
      const resolution = resolveBlockedPending(pending, {
        blocked: blocked !== undefined,
        promptSig: blockedPromptSignature(parsedPrompt),
        now: Date.now(),
        timeoutMs: blockedPendingTimeout(STATUS_POLL_MS * pollScale),
      });
      if (resolution === 'delivered' || resolution === 'superseded') clearBlockedPending();
    }
    return { blocked, panel };
  }, [clearBlockedPending, pollScale]);

  /**
   * Answer a blocked prompt (or poke the primary pane).
   *
   * When the target is a blocked agent, the reply is marked pending BEFORE it
   * is sent, and stays pending until a poll observes the agent act on it. The
   * poll is what removes the bar, and at the slowest setting it runs every ten
   * seconds, without the pending state that whole window accepts a second tap,
   * which sends a second digit + Enter into an agent that already moved on.
   *
   * The ref check is synchronous on purpose: the disabled prop the pending
   * state drives arrives only with the next render, and two fast taps fit
   * inside that gap.
   */
  const sendKeys = useCallback(
    async (keys: readonly string[]) => {
      const pane = blockedPane ?? primaryPane;
      if (client === null || pane === null) return;
      if (blockedPendingRef.current !== null) return;

      if (blockedPane !== null) {
        const pending: BlockedPending = {
          keys,
          promptSig: blockedPromptSignature(blockedPrompt),
          sentAt: Date.now(),
        };
        blockedPendingRef.current = pending;
        setBlockedPending(pending);
        // The banner is raised from here rather than from the poll: the poll's
        // success path clears the error state, so a banner it raised itself
        // would not survive its own iteration.
        blockedPendingTimer.current = setTimeout(
          () => {
            if (!aliveRef.current || blockedPendingRef.current !== pending) return;
            clearBlockedPending();
            setActionError(BLOCKED_PENDING_ERROR);
          },
          blockedPendingTimeout(STATUS_POLL_MS * pollScale)
        );
      }

      try {
        await client.sendKeys(pane.paneId, keys);
        // Look again once the terminal has redrawn, rather than at the next
        // poll: what comes after an answer is often another question.
        for (const delay of ANSWER_LOOKS_MS) {
          setTimeout(() => {
            if (aliveRef.current) kickRef.current();
          }, delay);
        }
      } catch (thrown) {
        // The keys never left the phone; nothing is pending on the host.
        clearBlockedPending();
        setActionError(errorText(thrown));
      }
    },
    // `pollScale` belongs here: the pending window is derived from the poll
    // interval, so a callback closing over a stale scale would arm the wrong
    // deadline after the setting changed.
    [client, blockedPane, primaryPane, blockedPrompt, clearBlockedPending, pollScale, aliveRef, kickRef, setActionError]
  );

  return { blockedPrompt, blockedPending, blockedPane, readQuestion, sendKeys };
}
