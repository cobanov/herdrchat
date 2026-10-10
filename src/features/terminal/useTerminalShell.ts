import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  base64FromBytes,
  closeShell,
  openShell,
  utf8Bytes,
  writeShellText,
  type ShellClosedEvent,
} from '../../../modules/herdr-ssh/src';
import { feed, type TerminalSize } from '../../../modules/herdr-terminal/src';
import { demoTerminalScreen } from '@/lib/demo/terminal';
import type { HerdrClient } from '@/lib/herdr/client';
import { SEND_TIMEOUT_MS } from '@/lib/herdr/timeouts';
import { leaveShellPane, zoomedOn, type PaneViewBefore, type TerminalPaneKind } from '@/lib/terminal/command';
import { isDemo, transportFor, type Connection } from '@/state/connections';
import type { TerminalPhase } from './status';
import { terminalLaunch } from './target';

/** What leaving the screen has to put back on the host: the zoom and focus a shell pane's attach moved. */
interface Leave {
  client: HerdrClient;
  paneId: string;
  before: PaneViewBefore;
}

/**
 * One pane's terminal shell, for as long as the screen is up.
 *
 * - It opens when the view first reports its size in cells (`onSizeChange`),
 *   since the remote pane is drawn at that size; the view resizes the channel
 *   itself after that.
 * - It ends on its own (the attach exits, the connection drops on a route
 *   change), and then stays ended: `reconnect` opens a new shell, which the
 *   same view shows under the scrollback of the last one.
 * - Leaving the screen hangs it up. Nothing runs on after the screen.
 *
 * A shell pane's attach zooms the pane in herdr first, so it fills the view,
 * and zoom and focus are herdr's SHARED state: the desktop's client zooms
 * too. Leaving undoes what the app did (`leaveShellPane`): the zoom unless
 * the pane was zoomed already, and the focus back to the pane that had it.
 */
export function useTerminalShell({ connection, client, paneId, kind, onOpened }: {
  connection: Connection | null;
  client: HerdrClient | null;
  paneId: string;
  kind: TerminalPaneKind;
  /** The shell is open and taking input. */
  onOpened?: () => void;
}) {
  const launch = useMemo(() => (connection === null ? null : terminalLaunch(connection, paneId, kind)), [connection, paneId, kind]);
  const [phase, setPhase] = useState<TerminalPhase>({ kind: 'waiting' });
  const [shellId, setShellId] = useState<string | null>(null);
  /** The view's size in cells, once it has one. */
  const size = useRef<TerminalSize | null>(null);
  /** The shell that is open now; null once it ended or before the first. */
  const live = useRef<string | null>(null);
  /** An open is under way: a second size report must not start another. */
  const starting = useRef(false);
  const mounted = useRef(true);
  const leave = useRef<Leave | null>(null);

  const open = useCallback(async () => {
    const cells = size.current;
    if (cells === null || launch === null || starting.current) return;
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
        // Left while dialling: this open zoomed nothing, but a reconnect's
        // earlier shell did, and the cleanup left that to this open.
        if (!mounted.current) {
          putBack(leave);
          return;
        }
        if (!up.ok) {
          setPhase({ kind: 'failed', message: up.message });
          return;
        }
        if (kind === 'shell' && client !== null && leave.current === null) {
          // As herdr had it before the app zoomed anything, read once: a
          // reconnect zooms again, and must not take its own zoom for the
          // person's.
          const before = await viewBefore(client, paneId);
          // Left while reading it: the launch line (the zoom) is never sent.
          if (!mounted.current) return;
          leave.current = { client, paneId, before };
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
        // Left while it opened. The cleanup left the zoom to this branch: the
        // launch line may have zoomed the pane after the cleanup ran, so it is
        // put back only once the channel is hung up.
        if (result.ok) await closeShell(result.shellId);
        putBack(leave);
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
  }, [launch, client, paneId, kind, onOpened]);

  const onSizeChange = useCallback((next: TerminalSize) => {
    const first = size.current === null;
    size.current = next;
    if (first) void open();
  }, [open]);

  const reconnect = useCallback(() => {
    const previous = live.current;
    live.current = null;
    if (previous !== null) void closeShell(previous);
    void open();
  }, [open]);

  /** Bytes from the accessory bar, to the shell that is open; nothing while none is. */
  const send = useCallback((text: string) => {
    const id = live.current;
    if (id !== null && text.length > 0) void writeShellText(id, text);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const id = live.current;
      live.current = null;
      if (id !== null) void closeShell(id);
      // An open still under way puts the zoom back itself, after it hangs
      // up (see `open`): restoring here could run before its launch line.
      if (!starting.current) putBack(leave);
    };
  }, []);

  // A pane no command can be written for never opens; said as a failure.
  const shown: TerminalPhase = connection !== null && launch === null
    ? { kind: 'failed', message: "This pane's id can't be passed to herdr safely." }
    : phase;
  return { phase: shown, shellId, onSizeChange, reconnect, send };
}

/** Undo what the app moved on the host, once: the ref is emptied. */
function putBack(leave: { current: Leave | null }): void {
  const left = leave.current;
  leave.current = null;
  if (left !== null) void restore(left);
}

function closedPhase(event: ShellClosedEvent): TerminalPhase {
  return { kind: 'closed', reason: event.reason, exitCode: event.exitCode ?? null, message: event.message ?? null };
}

async function viewBefore(client: HerdrClient, paneId: string): Promise<PaneViewBefore> {
  try {
    const snapshot = await client.snapshot();
    return { zoomed: zoomedOn(snapshot.layouts, paneId), focusedPaneId: snapshot.focusedPaneId };
  } catch {
    // Unknown: unzoom on leaving (the app zoomed it), and leave focus alone.
    return { zoomed: false, focusedPaneId: null };
  }
}

/** Best-effort, both halves: an older herdr without zoom or `pane.focus` changes nothing. */
async function restore({ client, paneId, before }: Leave): Promise<void> {
  const { unzoom, refocus } = leaveShellPane(paneId, before);
  if (unzoom !== null) {
    try {
      await client.transport.exec(unzoom, SEND_TIMEOUT_MS);
    } catch {
      // Nothing to tell anyone: the screen is gone.
    }
  }
  if (refocus !== null) {
    try {
      await client.socket.call(refocus.method, refocus.params, SEND_TIMEOUT_MS);
    } catch {
      // As above.
    }
  }
}
