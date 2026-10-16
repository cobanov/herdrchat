import { useCallback, useRef, useState, type RefObject } from 'react';

import type { HerdrClient } from '@/lib/herdr/client';
import { errorText } from '@/lib/herdr/protocol';
import { parsePaneOverlay, type PaneOverlay } from '@/lib/transcript/paneOverlay';

/**
 * After a slash command, how long to look for the panel it may open. Claude
 * draws one within a second; this is the ceiling, not the usual case.
 */
const OVERLAY_WATCH_MS = 8_000;
/** When to look for a new panel straight after a command, before the poll comes round. */
const OVERLAY_FIRST_LOOKS_MS = [400, 1_200] as const;
/** Between a key into a panel and reading what it did. */
const OVERLAY_SETTLE_MS = 300;
/** Rows of screen to read: a panel plus the composer under it. */
const OVERLAY_LINES = 40;

interface Options {
  client: HerdrClient | null;
  aliveRef: RefObject<boolean>;
  kickRef: RefObject<() => void>;
  setActionError: (error: string | null) => void;
}

/**
 * A slash command's panel open on the pane (`/model`, `/effort`), which the
 * agent's status does not report: it stays `idle` under one.
 */
export function usePaneOverlay({ client, aliveRef, kickRef, setActionError }: Options) {
  const [overlay, setOverlay] = useState<PaneOverlay | null>(null);
  /** Keys are on their way to the panel; its controls wait. */
  const [overlayBusy, setOverlayBusy] = useState(false);
  /** The pane the open panel is on, or null. Read by the poll, which must not re-run on it. */
  const overlayPane = useRef<string | null>(null);
  /** Until when the poll looks for a panel with no panel open yet. */
  const overlayWatchUntil = useRef(0);
  /** When a panel was last on screen, which confirms the command that opened it. */
  const overlaySeenAt = useRef(0);

  /**
   * Read the pane for a slash command's panel.
   *
   * Only while one is expected or open: this is a screen read over SSH, and a
   * read on every poll of every thread is what sank the first attempt at
   * slash commands (it queued behind itself and timed out unrelated calls).
   */
  const readOverlay = useCallback(async (paneId: string) => {
    if (client === null) return;
    const found = parsePaneOverlay(await client.paneVisible(paneId, OVERLAY_LINES));
    if (!aliveRef.current) return;
    if (found !== null) overlaySeenAt.current = Date.now();
    overlayPane.current = found === null ? null : paneId;
    setOverlay(found);
  }, [client, aliveRef]);

  const watchOverlay = useCallback((paneId: string) => {
    overlayWatchUntil.current = Date.now() + OVERLAY_WATCH_MS;
    for (const delay of OVERLAY_FIRST_LOOKS_MS) {
      setTimeout(() => {
        if (aliveRef.current && overlayPane.current === null) void readOverlay(paneId).catch(() => undefined);
      }, delay);
    }
    kickRef.current();
  }, [readOverlay, aliveRef, kickRef]);

  const sendOverlayKeys = useCallback(async (keys: readonly string[]) => {
    const paneId = overlayPane.current;
    if (client === null || paneId === null || overlayBusy) return;
    setOverlayBusy(true);
    try {
      if (keys.length > 0) await client.sendKeys(paneId, keys);
      await new Promise((resolve) => setTimeout(resolve, OVERLAY_SETTLE_MS));
      // A panel can lead to another (a confirmation), so keep looking a while.
      overlayWatchUntil.current = Date.now() + OVERLAY_WATCH_MS;
      await readOverlay(paneId);
    } catch (thrown) {
      setActionError(errorText(thrown));
    } finally {
      if (aliveRef.current) setOverlayBusy(false);
    }
  }, [client, overlayBusy, readOverlay, aliveRef, setActionError]);

  /** A panel is open, or a command was sent that may open one. */
  const watchingOverlay = useCallback(
    () => overlayWatchUntil.current > Date.now() || overlayPane.current !== null,
    []
  );

  const closeOverlay = useCallback(() => {
    if (overlayPane.current === null) return;
    overlayPane.current = null;
    setOverlay(null);
  }, []);

  /** When a panel was last on screen. */
  const overlaySeen = useCallback(() => overlaySeenAt.current, []);

  return { overlay, overlayBusy, readOverlay, watchOverlay, sendOverlayKeys, watchingOverlay, closeOverlay, overlaySeen };
}
