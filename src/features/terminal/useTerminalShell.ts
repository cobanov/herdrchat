import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  base64FromBytes,
  closeShell,
  openShell,
  resizeShell,
  utf8Bytes,
  writeShellText,
  type ShellClosedEvent,
} from '../../../modules/herdr-ssh/src';
import { feed, type TerminalSize } from '../../../modules/herdr-terminal/src';
import { demoTerminalScreen } from '@/lib/demo/terminal';
import { TERMINAL_RESIZE_DEBOUNCE_MS } from '@/lib/herdr/timeouts';
import { isDemo, transportFor, type Connection } from '@/state/connections';
import type { TerminalPhase } from './status';
import { noLaunchMessage, terminalLaunch, type TerminalPaneRef } from './target';

/**
 * One pane's terminal shell, for as long as the screen is up.
 *
 * - It opens when the view first reports its size in cells (`onSizeChange`),
 *   since the remote pane is drawn at that size. Later sizes reach the host
 *   once they hold still (`TERMINAL_RESIZE_DEBOUNCE_MS`): the keyboard's
 *   animation is many sizes, and each resize redraws the desktop's pane too.
 * - The app going to the background hangs it up, and coming back does not
 *   reconnect: a locked phone must not hold the attach, nor keep the desktop
 *   pane at the phone's size, and the pane is not resized under the person
 *   while they are not looking. Reconnect is theirs to tap.
 * - It ends on its own (the attach exits, the connection drops on a route
 *   change), and then stays ended: `reconnect` opens a new shell, which the
 *   same view shows under the scrollback of the last one.
 * - Leaving the screen hangs it up. Nothing runs on after the screen.
 *
 * Every attach is private to this screen (`attachCommand`): nothing on the
 * host moves, so there is nothing to put back on leaving. `takeOver` is the
 * one way to take a pane another client holds, and only the person calls it:
 * the first open and every reconnect ask without it.
 */
export function useTerminalShell({ connection, pane, onOpened }: {
  connection: Connection | null;
  pane: TerminalPaneRef;
  /** The shell is open and taking input. */
  onOpened?: () => void;
}) {
  const { paneId, kind, terminalId } = pane;
  /** The pane's launch, and the same with `--takeover` for the person's Take over. */
  const launches = useMemo(() => {
    if (connection === null) return null;
    const plain = terminalLaunch(connection, { paneId, kind, terminalId });
    const takeover = terminalLaunch(connection, { paneId, kind, terminalId }, true);
    return plain === null || takeover === null ? null : { plain, takeover };
  }, [connection, paneId, kind, terminalId]);
  const [phase, setPhase] = useState<TerminalPhase>({ kind: 'waiting' });
  const [shellId, setShellId] = useState<string | null>(null);
  /** The view's size in cells, once it has one. */
  const size = useRef<TerminalSize | null>(null);
  /** The shell that is open now; null once it ended or before the first. */
  const live = useRef<string | null>(null);
  /** An open is under way: a second size report must not start another. */
  const starting = useRef(false);
  const mounted = useRef(true);
  /** A resize waiting for the size to hold still. */
  const pendingResize = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelResize = useCallback(() => {
    if (pendingResize.current !== null) clearTimeout(pendingResize.current);
    pendingResize.current = null;
  }, []);

  const open = useCallback(async (takeover = false) => {
    const cells = size.current;
    if (cells === null || launches === null || starting.current) return;
    const launch = takeover ? launches.takeover : launches.plain;
    starting.current = true;
    setPhase({ kind: 'opening' });
    try {
      const demo = isDemo(launch.hostId);
      if (!demo) {
        // The channel rides on the host's connection, which the chat list
        // usually has up already. A cold one (straight in from a link) is
        // dialled here, through the same transport as everything else, so
        // its credentials and host-key pin are the same.
        const transport = transportFor(launch.hostId);
        if (transport === null) {
          setPhase({ kind: 'failed', message: 'This host is not connected.' });
          return;
        }
        const up = await transport.open();
        if (!mounted.current) return;
        if (!up.ok) {
          setPhase({ kind: 'failed', message: up.message });
          return;
        }
      }
      /**
       * The shell's id, once `openShell` gives it; until then an end that
       * arrives is this shell's (the listener is per shell) and is held: a
       * command that ends at once can report it before the promise resolves.
       */
      let opened: string | null = null;
      let endedEarly: ShellClosedEvent | null = null;
      const result = await openShell(launch.hostId, {
        command: launch.command,
        cols: cells.cols,
        rows: cells.rows,
        startTimeoutMs: launch.startTimeoutMs,
        onClosed: (event: ShellClosedEvent) => {
          if (opened === null) {
            endedEarly = event;
            return;
          }
          if (live.current !== event.shellId) return;
          live.current = null;
          if (!mounted.current) return;
          setPhase(closedPhase(event));
        },
      });
      if (!mounted.current) {
        // Left while it opened: hang it up, as leaving does.
        if (result.ok) await closeShell(result.shellId);
        return;
      }
      if (!result.ok) {
        setPhase({ kind: 'failed', message: result.message });
        return;
      }
      opened = result.shellId;
      setShellId(result.shellId);
      // A local, written in the callback: TypeScript's flow analysis does not
      // see that write, hence the cast.
      const early = endedEarly as ShellClosedEvent | null;
      if (early !== null) {
        // Over before it was ours: show its last output and how it ended.
        setPhase(closedPhase(early));
        return;
      }
      if (AppState.currentState === 'background') {
        // Opened while the app went away: hung up, as going away does.
        void closeShell(result.shellId);
        setPhase(BACKGROUND_PHASE);
        return;
      }
      live.current = result.shellId;
      setPhase({ kind: 'open' });
      onOpened?.();
      if (demo) {
        // The Demo's echo shell runs nothing: the screen the attach would
        // have drawn is its recording, fed to the view as if it came over SSH.
        const screen = demoTerminalScreen(launch.command, launch.host);
        if (screen !== null) feed(result.shellId, base64FromBytes(utf8Bytes(screen)));
      }
    } finally {
      starting.current = false;
    }
  }, [launches, onOpened]);

  const onSizeChange = useCallback((next: TerminalSize) => {
    const first = size.current === null;
    size.current = next;
    if (first) {
      void open();
      return;
    }
    // A shell that opens meanwhile is sized by the view when it binds.
    cancelResize();
    pendingResize.current = setTimeout(() => {
      pendingResize.current = null;
      const id = live.current;
      const cells = size.current;
      if (id !== null && cells !== null) void resizeShell(id, cells.cols, cells.rows);
    }, TERMINAL_RESIZE_DEBOUNCE_MS);
  }, [open, cancelResize]);

  /** A new shell after the last ended; `takeover` only from the person's Take over. */
  const reopen = useCallback((takeover: boolean) => {
    const previous = live.current;
    live.current = null;
    if (previous !== null) void closeShell(previous);
    void open(takeover);
  }, [open]);
  const reconnect = useCallback(() => reopen(false), [reopen]);
  const takeOver = useCallback(() => reopen(true), [reopen]);

  /** Bytes from the accessory bar, to the shell that is open; nothing while none is. */
  const send = useCallback((text: string) => {
    const id = live.current;
    if (id !== null && text.length > 0) void writeShellText(id, text);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'background') return;
      cancelResize();
      const id = live.current;
      if (id === null) return;
      live.current = null;
      void closeShell(id);
      if (mounted.current) setPhase(BACKGROUND_PHASE);
    });
    return () => subscription.remove();
  }, [cancelResize]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelResize();
      const id = live.current;
      live.current = null;
      if (id !== null) void closeShell(id);
    };
  }, [cancelResize]);

  // A pane no command can be written for never opens; said as a failure that
  // offers no Reconnect, since `open` has nothing to run.
  const shown: TerminalPhase = connection !== null && launches === null
    ? { kind: 'failed', message: noLaunchMessage({ kind, terminalId }), retryable: false }
    : phase;
  return { phase: shown, shellId, onSizeChange, reconnect, takeOver, send };
}

/** What the screen shows after the app hung up on going to the background. */
const BACKGROUND_PHASE: TerminalPhase = { kind: 'closed', reason: 'background', exitCode: null, message: null };

function closedPhase(event: ShellClosedEvent): TerminalPhase {
  return { kind: 'closed', reason: event.reason, exitCode: event.exitCode ?? null, message: event.message ?? null };
}
