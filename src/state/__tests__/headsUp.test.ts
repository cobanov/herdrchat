import { DemoHost } from '@/lib/demo/host';
import { DEMO_HEADSUP_PATH } from '@/lib/demo/scenarios';
import { HEADSUP_DETECT_INTERVAL_MS } from '@/lib/headsup/client';
import { markReplied, resolveItem, clearReplied } from '@/lib/headsup/items';
import {
  changeHostHeadsUp,
  checkHeadsUp,
  headsUpOf,
  resetHeadsUpSession,
  setHeadsUpChats,
  useHeadsUp,
} from '../headsUp';

const T0 = Date.parse('2026-10-24T12:00:00Z');

function demo() {
  const host = new DemoHost(() => T0);
  const exec = jest.spyOn(host, 'exec');
  return { host, exec };
}

beforeEach(() => resetHeadsUpSession());

describe('checkHeadsUp', () => {
  it('on a host without the mod looks once, holds nothing, and looks again only on the cadence', async () => {
    const { host, exec } = demo();
    await checkHeadsUp('demo', host, { now: T0 });
    expect(headsUpOf('demo')).toMatchObject({ path: null, file: null, detectedAt: T0 });
    expect(exec).toHaveBeenCalledTimes(1);
    await checkHeadsUp('demo', host, { now: T0 + 10_000 });
    expect(exec).toHaveBeenCalledTimes(1);
    await checkHeadsUp('demo', host, { now: T0 + HEADSUP_DETECT_INTERVAL_MS });
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('notices the mod installed later when asked to look (a pull), and reads its list', async () => {
    const { host } = demo();
    await checkHeadsUp('demo', host, { now: T0 });
    host.setUpHeadsUp('w2:p1');
    await checkHeadsUp('demo', host, { now: T0 + 10_000 });
    expect(headsUpOf('demo').path).toBeNull();
    await checkHeadsUp('demo', host, { now: T0 + 20_000, detect: true });
    expect(headsUpOf('demo').path).toBe(DEMO_HEADSUP_PATH);
    expect(headsUpOf('demo').file?.items).toHaveLength(5);
  });

  it('reads an unchanged list without replacing what it holds', async () => {
    const { host } = demo();
    host.setUpHeadsUp('w2:p1');
    await checkHeadsUp('demo', host, { now: T0 });
    const before = useHeadsUp.getState().byConnection;
    await checkHeadsUp('demo', host, { now: T0 + 10_000 });
    expect(useHeadsUp.getState().byConnection).toBe(before);
  });

  it('drops an answer for a host removed while it was out', async () => {
    const { host } = demo();
    host.setUpHeadsUp('w2:p1');
    const check = checkHeadsUp('demo', host, { now: T0 });
    useHeadsUp.getState().clear('demo');
    await check;
    expect(useHeadsUp.getState().byConnection.demo).toBeUndefined();
  });

  it('never rejects, and keeps what it has, when the host is down', async () => {
    const { host } = demo();
    host.setUpHeadsUp('w2:p1');
    await checkHeadsUp('demo', host, { now: T0 });
    const held = headsUpOf('demo');
    const down = { exec: async () => { throw new Error('gone'); }, streamLines: host.streamLines.bind(host) };
    await expect(checkHeadsUp('demo', down, { now: T0 + 10_000, detect: true })).resolves.toBeUndefined();
    expect(headsUpOf('demo')).toEqual(held);
  });
});

describe('changeHostHeadsUp', () => {
  it('resolves, marks replied and takes it back, keeping the item’s other fields and the file’s other keys', async () => {
    const { host } = demo();
    host.setUpHeadsUp('w2:p1');
    await checkHeadsUp('demo', host, { now: T0 });

    await expect(changeHostHeadsUp('demo', host, resolveItem('demohu5n', T0))).resolves.toBe(true);
    expect(headsUpOf('demo').file?.items.find((item) => item.id === 'demohu5n')).toMatchObject({ status: 'done', doneAt: T0 });

    await expect(changeHostHeadsUp('demo', host, markReplied('demohu1q', T0 + 1))).resolves.toBe(true);
    expect(headsUpOf('demo').file?.items.find((item) => item.id === 'demohu1q')?.repliedAt).toBe(T0 + 1);
    await expect(changeHostHeadsUp('demo', host, clearReplied('demohu1q'))).resolves.toBe(true);
    expect(headsUpOf('demo').file?.items.find((item) => item.id === 'demohu1q')?.repliedAt).toBeNull();

    const raw = headsUpOf('demo').file!.raw;
    expect(raw).toHaveProperty('lastPrunedAt');
    expect((raw.items as { id: string }[]).map((item) => item.id)).toContain('demohu6r');
    // And the host has exactly what the app holds.
    expect(JSON.parse(host.headsUpText()!)).toEqual(raw);
  });

  it('takes two taps one after the other, each against the version the last one left', async () => {
    const { host } = demo();
    host.setUpHeadsUp('w2:p1');
    await checkHeadsUp('demo', host, { now: T0 });
    const results = await Promise.all([
      changeHostHeadsUp('demo', host, resolveItem('demohu5n', 1)),
      changeHostHeadsUp('demo', host, resolveItem('demohu4x', 2)),
    ]);
    expect(results).toEqual([true, true]);
    const items = JSON.parse(host.headsUpText()!).items as { id: string; status: string }[];
    expect(items.filter((item) => item.status === 'done').map((item) => item.id).sort()).toEqual(['demohu4x', 'demohu5n']);
  });

  it('says it could not, on a host with no list', async () => {
    const { host } = demo();
    await expect(changeHostHeadsUp('demo', host, resolveItem('x', 1))).resolves.toBe(false);
  });
});

describe('setHeadsUpChats', () => {
  it('changes nothing when the chats are the ones held', () => {
    const chats = [{ sessionId: 's', workspaceId: 'w1', paneId: 'w1:p1', soleAgent: true }];
    setHeadsUpChats('demo', chats);
    const before = useHeadsUp.getState().byConnection;
    setHeadsUpChats('demo', [{ ...chats[0]! }]);
    expect(useHeadsUp.getState().byConnection).toBe(before);
  });
});
