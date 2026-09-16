import { EventFeed, interpret, subscriptionsFor, type HostEvent } from '../herdr/events';
import { HerdrError } from '../herdr/protocol';
import type { HerdrSocket, SocketEvent, Subscription } from '../herdr/socket';

/**
 * A socket whose `subscribe` is scripted: each call takes the next script
 * entry, which either yields events until told to end, or throws.
 */
class ScriptedSocket {
  readonly calls: Subscription[][] = [];
  private readonly scripts: ('hang' | 'end' | HerdrError | SocketEvent[])[];
  /** Resolvers for connections left hanging, so a test can end them. */
  readonly hanging: (() => void)[] = [];
  active = 0;

  constructor(scripts: ('hang' | 'end' | HerdrError | SocketEvent[])[]) {
    this.scripts = scripts;
  }

  subscribe = async function* (
    this: ScriptedSocket,
    subscriptions: readonly Subscription[],
    _timeout: number,
    signal?: AbortSignal
  ): AsyncIterable<SocketEvent> {
    this.calls.push([...subscriptions]);
    const script = this.scripts.shift() ?? 'hang';
    if (script instanceof HerdrError) throw script;
    if (script === 'end') return;
    if (Array.isArray(script)) {
      yield* script;
      return;
    }
    this.active += 1;
    try {
      await new Promise<void>((resolve) => {
        this.hanging.push(resolve);
        if (signal?.aborted) resolve();
        else signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    } finally { this.active -= 1; }
  }.bind(this) as HerdrSocket['subscribe'];

  asSocket(): HerdrSocket {
    return { subscribe: this.subscribe } as unknown as HerdrSocket;
  }
}

const statusEvent = (paneId: string, status: string): SocketEvent => ({
  kind: 'event',
  event: 'pane.agent_status_changed',
  data: { agent: 'claude', agent_status: status, pane_id: paneId, workspace_id: paneId.split(':')[0], turn: 1 },
});

/** Let the async generators run to their next await. Fake timers are on, so no setTimeout here. */
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

describe('subscriptionsFor', () => {
  it('asks for the workspace lifecycle once and each pane event per pane', () => {
    const entries = subscriptionsFor(['w1:p1', 'w2:p1']);
    expect(entries.filter((e) => e.type.startsWith('workspace.')).every((e) => e.pane_id === undefined)).toBe(true);
    expect(entries.filter((e) => e.type === 'pane.turn_completed').map((e) => e.pane_id)).toEqual(['w1:p1', 'w2:p1']);
  });
});

describe('interpret', () => {
  it('lifts the pane and workspace ids off a flat event', () => {
    expect(interpret(statusEvent('w1:p1', 'working'))).toMatchObject({
      event: 'pane.agent_status_changed',
      paneId: 'w1:p1',
      workspaceId: 'w1',
    });
  });

  it('finds them inside the nested pane record of turn_completed', () => {
    const raw: SocketEvent = {
      kind: 'event',
      event: 'pane.turn_completed',
      data: { turn: 1, outcome: 'completed', pane: { pane_id: 'w3:p1', workspace_id: 'w3' } },
    };
    expect(interpret(raw)).toMatchObject({ paneId: 'w3:p1', workspaceId: 'w3' });
  });

  it('drops per-subscription refusals', () => {
    expect(interpret({ kind: 'refused', code: 'pane_not_found', message: '' })).toBeNull();
  });
});

describe('EventFeed', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('replaces and stops silent subscriptions without accumulating bridges', async () => {
    const socket = new ScriptedSocket([]);
    const feed = new EventFeed(socket.asSocket(), () => undefined, () => undefined);
    for (let i = 0; i < 20; i += 1) {
      feed.watch([`w${i}:p1`]);
      await flush();
      expect(socket.active).toBe(1);
    }
    feed.stop();
    await flush();
    expect(socket.active).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('delivers events and reports the stream live on the first one', async () => {
    const socket = new ScriptedSocket([[statusEvent('w1:p1', 'working'), statusEvent('w1:p1', 'done')]]);
    const events: HostEvent[] = [];
    const liveness: boolean[] = [];
    const feed = new EventFeed(socket.asSocket(), (e) => events.push(e), (l) => liveness.push(l));
    feed.watch(['w1:p1']);
    await flush();
    expect(events.map((e) => e.data['agent_status'])).toEqual(['working', 'done']);
    expect(liveness[0]).toBe(true);
    feed.stop();
  });

  it('does not reconnect for an unchanged pane set, and does for a changed one', async () => {
    const socket = new ScriptedSocket(['hang', 'hang']);
    const feed = new EventFeed(socket.asSocket(), () => undefined, () => undefined);
    feed.watch(['w1:p1', 'w2:p1']);
    feed.watch(['w2:p1', 'w1:p1']);
    await flush();
    expect(socket.calls).toHaveLength(1);
    feed.watch(['w1:p1', 'w2:p1', 'w3:p1']);
    await flush();
    expect(socket.calls).toHaveLength(2);
    expect(socket.calls[1]?.some((s) => s.pane_id === 'w3:p1')).toBe(true);
    feed.stop();
  });

  it('reconnects with backoff when the host closes the stream', async () => {
    const socket = new ScriptedSocket(['end', 'end', 'hang']);
    const liveness: boolean[] = [];
    const feed = new EventFeed(socket.asSocket(), () => undefined, (l) => liveness.push(l));
    feed.watch(['w1:p1']);
    await flush();
    expect(socket.calls).toHaveLength(1);
    // A clean end is not counted as a failure, so the first retry is at the base delay.
    await jest.advanceTimersByTimeAsync(1_000);
    expect(socket.calls).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(socket.calls).toHaveLength(3);
    feed.stop();
  });

  it('backs off further after each failed attempt', async () => {
    const socket = new ScriptedSocket([
      new HerdrError('transport_failed', 'reset'),
      new HerdrError('transport_failed', 'reset'),
      'hang',
    ]);
    const feed = new EventFeed(socket.asSocket(), () => undefined, () => undefined);
    feed.watch(['w1:p1']);
    await flush();
    expect(socket.calls).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(2_000); // 1000 * 2^1
    expect(socket.calls).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(3_999);
    expect(socket.calls).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1); // 1000 * 2^2
    expect(socket.calls).toHaveLength(3);
    feed.stop();
  });

  it('gives up quietly on a host with no socket bridge', async () => {
    const socket = new ScriptedSocket([new HerdrError('socket_unavailable', 'no bridge')]);
    const liveness: boolean[] = [];
    const feed = new EventFeed(socket.asSocket(), () => undefined, (l) => liveness.push(l));
    feed.watch(['w1:p1']);
    await flush();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(socket.calls).toHaveLength(1);
    expect(liveness).toEqual([]);
  });

  it('ignores events from a connection it has replaced', async () => {
    const socket = new ScriptedSocket(['hang', [statusEvent('w2:p1', 'working')]]);
    const events: HostEvent[] = [];
    const feed = new EventFeed(socket.asSocket(), (e) => events.push(e), () => undefined);
    feed.watch(['w1:p1']);
    await flush();
    feed.watch(['w1:p1', 'w2:p1']);
    await flush();
    // Let the first connection end now; nothing it says counts.
    socket.hanging[0]?.();
    await flush();
    expect(events.map((e) => e.paneId)).toEqual(['w2:p1']);
    feed.stop();
  });

  it('stop() ends the stream and prevents any reconnect', async () => {
    const socket = new ScriptedSocket(['end', 'hang']);
    const liveness: boolean[] = [];
    const feed = new EventFeed(socket.asSocket(), () => undefined, (l) => liveness.push(l));
    feed.watch(['w1:p1']);
    await flush();
    feed.stop();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(socket.calls).toHaveLength(1);
  });
});
