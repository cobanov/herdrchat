import type { ExecResult } from '../../../modules/herdr-ssh/src';
import { HerdrClient } from '../herdr/client';
import {
  droppedMachineIds,
  MACHINE_LIST_INTERVAL_MS,
  isUnderHost,
  listedMachines,
  machineConnectionId,
  machineListDue,
  machineListCommand,
  parseMachineList,
  splitMachineConnectionId,
} from '../herdr/machines';
import { isSocketProbe } from '../herdr/socket';
import type { HerdrTransport } from '../herdr/transport';

// As `herdr machine list --json` printed it on Gimel, 2026-10-09.
const MEASURED =
  '[{"id":"6eff1dfe9fc09961768a727981b54b98","label":"klaw","target":"klaw","session":"default","enabled":true,"selected":true}]';

describe('parseMachineList', () => {
  it('reads the list herdr prints, ignoring keys it does not use', () => {
    expect(parseMachineList(MEASURED)).toEqual({
      machines: [{ id: '6eff1dfe9fc09961768a727981b54b98', label: 'klaw', target: 'klaw', session: 'default', enabled: true }],
      skipped: [],
      unreadIds: [],
      complete: true,
    });
  });

  it('keeps a disabled machine, marked, so the cache still knows it', () => {
    const { machines } = parseMachineList('[{"id":"a","label":"old","target":"old","session":"work","enabled":false}]');
    expect(machines).toEqual([{ id: 'a', label: 'old', target: 'old', session: 'work', enabled: false }]);
  });

  it('defaults what a newer or older herdr might leave out', () => {
    const { machines } = parseMachineList('[{"id":"a","target":"box.local"}]');
    expect(machines).toEqual([{ id: 'a', label: 'box.local', target: 'box.local', session: 'default', enabled: true }]);
  });

  it('skips a bad row and reports it, keeping the rest', () => {
    const { machines, skipped, unreadIds } = parseMachineList(
      JSON.stringify([
        { id: 'good', label: 'klaw', target: 'klaw' },
        { label: 'no id', target: 'x' },
        { id: 'no-target', label: 'x' },
        { id: 'a/b', target: 'x' },
        { id: 'flag', target: 'x', enabled: 'yes' },
        'not a row',
        { id: 'good', target: 'twice' },
      ])
    );
    expect(machines.map((machine) => machine.id)).toEqual(['good']);
    expect(skipped).toEqual([
      'machine 2: no id',
      'machine 3: no-target has no target',
      'machine 4: id a/b has a slash',
      'machine 5: flag has an unreadable enabled flag',
      'machine 6: not an object',
      'machine 7: good is listed twice',
    ]);
    // Still listed, so not removed; `good` was read, and `a/b` can never have been held.
    expect(unreadIds).toEqual(['no-target', 'a/b', 'flag']);
  });

  it('reads an empty list as no machines, and empty output as saying nothing', () => {
    expect(parseMachineList('[]')).toEqual({ machines: [], skipped: [], unreadIds: [], complete: true });
    expect(parseMachineList('  \n')).toEqual({ machines: [], skipped: [], unreadIds: [], complete: false });
  });

  it('accepts the list inside an envelope or under `machines`', () => {
    expect(parseMachineList(`{"id":"cli","result":{"machines":${MEASURED}}}`).machines).toHaveLength(1);
    expect(parseMachineList(`{"machines":${MEASURED}}`).machines).toHaveLength(1);
  });

  it('fails clearly on output that holds no list', () => {
    expect(() => parseMachineList('Usage: herdr machine …')).toThrow(expect.objectContaining({ code: 'unparseable_response' }));
    expect(() => parseMachineList('{"ok":true}')).toThrow(expect.objectContaining({ code: 'unparseable_response' }));
  });
});

describe('machine connection ids', () => {
  it('joins and splits host and machine', () => {
    const id = machineConnectionId('host-1', '6eff');
    expect(id).toBe('host-1/6eff');
    expect(splitMachineConnectionId(id)).toEqual({ hostId: 'host-1', machineId: '6eff' });
  });

  it('answers null for a host id, the Demo, or anything malformed', () => {
    for (const id of ['host-1', 'demo', '/x', 'x/', 'a/b/c', '']) {
      expect(splitMachineConnectionId(id)).toBeNull();
    }
  });

  it('knows which keys belong under a host', () => {
    expect(isUnderHost('host-1/6eff', 'host-1')).toBe(true);
    expect(isUnderHost('host-1', 'host-1')).toBe(false);
    expect(isUnderHost('host-10/6eff', 'host-1')).toBe(false);
  });
});

describe('HerdrClient.machines', () => {
  function host(answer: ExecResult) {
    const commands: string[] = [];
    const transport: HerdrTransport = {
      exec: async (command) => {
        commands.push(command);
        // No socket here, so the client takes the CLI path.
        return isSocketProbe(command) ? { ok: true, stdout: '', stderr: '', exitCode: 1 } : answer;
      },
      streamLines: async function* () {},
    };
    return { transport, commands };
  }

  it('runs `herdr machine list --json` and parses it', async () => {
    const { transport, commands } = host({ ok: true, stdout: MEASURED, stderr: '', exitCode: 0 });
    const list = await new HerdrClient(transport, '~/.local/bin/herdr').machines();
    expect(list.machines.map((machine) => machine.label)).toEqual(['klaw']);
    expect(commands).toEqual([machineListCommand('~/.local/bin/herdr')]);
  });

  it('reads a herdr with no machine verb as no machines, not a failure', async () => {
    const { transport } = host({ ok: true, stdout: '', stderr: "error: unrecognized subcommand 'machine'", exitCode: 2 });
    await expect(new HerdrClient(transport).machines()).resolves.toEqual({ machines: [], skipped: [], unreadIds: [], complete: true });
  });

  it('keeps every other failure a failure', async () => {
    const { transport } = host({ ok: false, code: 'timeout', message: 'slow' });
    await expect(new HerdrClient(transport).machines()).rejects.toMatchObject({ code: 'timeout' });
  });
});

describe('machineListDue', () => {
  it('is due when never asked or asked for, then once a minute', () => {
    expect(machineListDue(null, 5)).toBe(true);
    expect(machineListDue(1_000, 1_000 + MACHINE_LIST_INTERVAL_MS - 1)).toBe(false);
    expect(machineListDue(1_000, 1_000 + MACHINE_LIST_INTERVAL_MS)).toBe(true);
    expect(MACHINE_LIST_INTERVAL_MS).toBe(60_000);
  });
});

describe('droppedMachineIds', () => {
  const machine = (id: string, enabled = true) => ({ id, label: id, target: id, session: 'default', enabled });
  it('names the machines the new list leaves out, and not the disabled ones it keeps', () => {
    expect(droppedMachineIds([machine('a'), machine('b'), machine('c')], [machine('a'), machine('c', false)])).toEqual(['b']);
    expect(droppedMachineIds([], [machine('a')])).toEqual([]);
    expect(droppedMachineIds([machine('a')], [])).toEqual(['a']);
  });
});

// #159 review: a row the host still listed but that no longer parsed (a field's
// shape changed in a herdr update), or a blank answer, read as the machine
// being removed, and its chats were forgotten for good.
describe('listedMachines', () => {
  const machine = (id: string) => ({ id, label: id, target: id, session: 'default', enabled: true });
  const answer = (machines: ReturnType<typeof machine>[], unreadIds: string[] = [], complete = true) => ({
    machines,
    skipped: unreadIds.map((id) => `${id} unreadable`),
    unreadIds,
    complete,
  });

  it('keeps the last good row of a machine still listed but unreadable', () => {
    const held = [machine('a'), machine('b'), machine('c')];
    const kept = listedMachines(held, answer([machine('a')], ['b', 'z']));
    expect(kept.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(kept[1]).toBe(held[1]);
    expect(droppedMachineIds(held, kept)).toEqual(['c']);
  });

  it('keeps everything on an answer that says nothing, and drops nothing', () => {
    const held = [machine('a')];
    expect(listedMachines(held, parseMachineList(''))).toBe(held);
    expect(listedMachines([], parseMachineList(''))).toEqual([]);
    expect(listedMachines(undefined, parseMachineList(''))).toEqual([]);
  });

  it('takes the answer as it is otherwise, an empty list included', () => {
    expect(listedMachines([machine('a')], answer([]))).toEqual([]);
    expect(listedMachines(undefined, answer([machine('a')]))).toEqual([machine('a')]);
  });
});
