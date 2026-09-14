import { HerdrError } from './protocol';
import type { HerdrSocket, SocketEvent, Subscription } from './socket';

/**
 * One `events.subscribe` connection per host, kept open, with reconnection.
 *
 * What it replaces: two poll loops asking "anything new?" every few seconds,
 * each answer a full SSH round-trip, most of them "no". With the feed, herdr
 * says when something changed and the poll becomes a slow safety net.
 *
 * Subscriptions are pane-scoped and there is no wildcard (measured; see
 * `docs/research/herdr-socket-api-measurements.md`), so the feed has to know
 * which panes to watch and start a fresh connection when that set changes. It
 * also watches the workspace lifecycle, which needs no pane id, so a chat
 * created or closed on the desktop shows up without waiting for a poll.
 *
 * No React in here. `onEvent` and `onLive` are plain callbacks, so this can be
 * driven by a test with a scripted socket, and a hook wraps it in one effect.
 */
export class EventFeed {
  private panes: string[] = [];
  private generation = 0;
  private running = false;
  private failures = 0;
  private live = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly socket: HerdrSocket,
    private readonly onEvent: (event: HostEvent) => void,
    /** True while a subscription is open, false between attempts. */
    private readonly onLive: (live: boolean) => void
  ) {}

  /**
   * Watch these panes. Idempotent for an unchanged set; otherwise the current
   * connection is dropped and a new one opened, because a subscription cannot
   * be amended once started.
   *
   * "Dropped" means: the next line it delivers is discarded and the loop exits,
   * which closes the remote command. An async generator parked on a read cannot
   * be interrupted from outside (its `return()` queues behind the pending
   * await), so a superseded connection lingers until the host says something
   * on it. Every pane it watched is also watched by its successor, so that is
   * at most one idle bridge process per change of pane set, gone on the next
   * status flip anywhere on the host.
   */
  watch(paneIds: readonly string[]): void {
    const next = [...new Set(paneIds)].sort();
    const same = next.length === this.panes.length && next.every((id, i) => id === this.panes[i]);
    this.panes = next;
    if (this.running && same) return;
    this.running = true;
    this.restart();
  }

  /** Close the connection and stop reconnecting. Safe to call twice. */
  stop(): void {
    this.running = false;
    this.generation += 1;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.setLive(false);
  }

  private restart(): void {
    this.generation += 1;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    void this.run(this.generation);
  }

  private async run(generation: number): Promise<void> {
    const subscriptions = subscriptionsFor(this.panes);
    try {
      for await (const raw of this.socket.subscribe(subscriptions, SUBSCRIBE_START_TIMEOUT_MS)) {
        // A newer connection has taken over, or stop() was called: this loop's
        // job is only to let go, and breaking out closes the remote command.
        if (generation !== this.generation) break;
        if (!this.live) {
          // The first line proves the stream is delivering, and the streak of
          // failures that led here is over.
          this.failures = 0;
          this.setLive(true);
        }
        const event = interpret(raw);
        if (event !== null) this.onEvent(event);
      }
    } catch (thrown) {
      if (generation !== this.generation) return;
      if (thrown instanceof HerdrError && thrown.code === 'socket_unavailable') {
        // This host cannot be reached over the socket. Nothing to retry; the
        // poll loops carry on at their normal rate.
        this.running = false;
        this.setLive(false);
        return;
      }
      this.failures += 1;
    }
    if (generation !== this.generation || !this.running) return;
    // Ended without an error (host closed the connection) or with one: either
    // way, come back. Doubling, capped, like the poll loops' own backoff.
    this.setLive(false);
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.failures, RECONNECT_CEILING_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (generation === this.generation && this.running) void this.run(generation);
    }, delay);
  }

  private setLive(live: boolean): void {
    if (this.live === live) return;
    this.live = live;
    this.onLive(live);
  }
}

/** An event from the host, with the ids the app keys on lifted out of the payload. */
export interface HostEvent {
  readonly event: string;
  readonly paneId: string | null;
  readonly workspaceId: string | null;
  readonly data: Record<string, unknown>;
}

/** Pane events the app reacts to. Each needs its own subscription entry per pane. */
export const PANE_EVENTS = [
  'pane.agent_status_changed',
  'pane.turn_completed',
  'pane.agent_detected',
  'pane.exited',
] as const;

/** Workspace lifecycle. No pane id; one entry each covers the whole host. */
export const WORKSPACE_EVENTS = [
  'workspace.created',
  'workspace.closed',
  'workspace.renamed',
  'workspace.updated',
] as const;

/**
 * Bound getting the command running, not the stream: SSH channel open plus the
 * bridge's own start. Generous because a failure here is retried anyway.
 */
const SUBSCRIBE_START_TIMEOUT_MS = 10_000;

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_CEILING_MS = 30_000;

/** The subscription list for a set of panes. Exported for tests. */
export function subscriptionsFor(paneIds: readonly string[]): Subscription[] {
  const entries: Subscription[] = WORKSPACE_EVENTS.map((type) => ({ type }));
  for (const paneId of paneIds) {
    for (const type of PANE_EVENTS) entries.push({ type, pane_id: paneId });
  }
  return entries;
}

/**
 * A raw stream item as a `HostEvent`, or null for the ones the app does not
 * act on. A per-pane refusal (the pane closed between the list and the
 * subscribe) is not an event; the next `workspace.closed` or poll covers it.
 *
 * `pane.turn_completed` nests the pane record under `pane`; the others carry
 * `pane_id` at the top. Both shapes were observed on the wire.
 */
export function interpret(raw: SocketEvent): HostEvent | null {
  if (raw.kind !== 'event') return null;
  const nested =
    typeof raw.data['pane'] === 'object' && raw.data['pane'] !== null
      ? (raw.data['pane'] as Record<string, unknown>)
      : null;
  const paneId = stringOrNull(raw.data['pane_id']) ?? stringOrNull(nested?.['pane_id']);
  const workspaceId =
    stringOrNull(raw.data['workspace_id']) ??
    stringOrNull(nested?.['workspace_id']) ??
    (paneId !== null ? paneId.split(':')[0] ?? null : null);
  return { event: raw.event, paneId, workspaceId, data: raw.data };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
