import type { ExecResult } from '../../../modules/herdr-ssh/src';
import { DemoHost } from '../demo/host';
import { DEMO_CLAUDE_BINARY, DEMO_CLAUDE_BINARY_STAT, DEMO_NOTES_CWD } from '../demo/slashCommands';
import { SLASH_GREP_RETRY_MS, SLASH_SCAN_INTERVAL_MS, SLASH_SCAN_TIMEOUT_MS } from '../herdr/timeouts';
import type { HerdrTransport } from '../herdr/transport';
import { AGY_BUILTINS, CLAUDE_BUILTINS, CODEX_BUILTINS, GROK_BUILTINS } from '../slashCommands/builtins';
import {
  applyScan,
  catalogueFor,
  deserializeCatalogueCache,
  emptyCatalogueCache,
  knownBinaryFor,
  MAX_CACHED_PROJECTS,
  projectScanned,
  serializeCatalogueCache,
  type SlashCatalogueCache,
} from '../slashCommands/catalogue';
import { projectFoldersToScan, scanSlashCommands, slashScanDue } from '../slashCommands/client';
import { MAX_PROJECTS_PER_SCAN } from '../slashCommands/discover';
import { filterCommands, paletteQuery, paletteSections } from '../slashCommands/filter';
import type { ScanResult } from '../slashCommands/parse';
import {
  describesSideEffect,
  DESTRUCTIVE_COMMANDS,
  fillsOnPick,
  hintRequiresArgument,
  pickSlashCommand,
  SIDE_EFFECT_COMMANDS,
} from '../slashCommands/pick';
import type { CatalogueCommand } from '../slashCommands/types';

const command = (
  name: string,
  section: CatalogueCommand['section'] = 'builtin',
  description = '',
  argumentHint: string | null = null
): CatalogueCommand => ({
  name,
  description,
  argumentHint,
  section,
  source: section === 'builtin' ? 'builtin' : section === 'plugins' ? 'plugin' : 'user',
});

describe('filtering, the terminal’s way', () => {
  const catalogue = [
    command('compact', 'builtin', 'Summarise the conversation'),
    command('context', 'builtin', 'Show context usage'),
    command('model', 'builtin', 'Choose the model'),
    command('release-notes', 'skills', 'Write release notes from the git log'),
    command('review', 'commands', 'Review the open pull request'),
    command('git:preview', 'commands', 'Preview the branch'),
    command('demo-tools:lint', 'plugins', 'Lint, then review the result'),
  ];
  const names = (list: CatalogueCommand[]) => list.map((entry) => entry.name);

  it('reads only a draft still choosing a command', () => {
    expect(paletteQuery('/')).toBe('');
    expect(paletteQuery('/Rev')).toBe('rev');
    expect(paletteQuery('/demo-tools:li')).toBe('demo-tools:li');
    expect(paletteQuery('/review ')).toBeNull();
    expect(paletteQuery('review')).toBeNull();
    expect(paletteQuery(' /review')).toBeNull();
  });

  it('offers everything for a bare slash, in catalogue order', () => {
    expect(names(filterCommands(catalogue, ''))).toEqual(names(catalogue));
  });

  it('puts a name prefix first, then a name substring, then a description match, section order breaking ties', () => {
    expect(names(filterCommands(catalogue, 'rev'))).toEqual(['review', 'git:preview', 'demo-tools:lint']);
    expect(names(filterCommands(catalogue, 're'))).toEqual(['release-notes', 'review', 'git:preview', 'demo-tools:lint']);
    expect(names(filterCommands(catalogue, 'con'))).toEqual(['context', 'compact']);
    expect(names(filterCommands(catalogue, 'zzz'))).toEqual([]);
  });

  // The review of 4d5c706: ranked by section first, `/mi` put eight built-ins
  // that only mention "mi" in their descriptions above the skill /mind.
  it('ranks a name prefix in any section above a description match in Built-in', () => {
    const mixed = [
      command('permissions', 'builtin', 'Manage allow and deny rules'),
      command('diff', 'builtin', 'Show the changes, file by file'),
      command('upgrade', 'builtin', 'Upgrade to Max for higher rate limits'),
      command('mind', 'skills', 'Read and write the vault'),
      command('herdr', 'skills', 'Control Herdr'),
    ];
    expect(names(filterCommands(mixed, 'mi'))).toEqual(['mind', 'permissions', 'upgrade']);
    expect(names(filterCommands(mixed, 'her'))).toEqual(['herdr', 'upgrade']);
  });

  it('browses a bare slash by section, and searches a typed name as one ranked list', () => {
    expect(paletteSections('/', catalogue).map((section) => [section.section, names(section.commands)])).toEqual([
      ['builtin', ['compact', 'context', 'model']],
      ['skills', ['release-notes']],
      ['commands', ['review', 'git:preview']],
      ['plugins', ['demo-tools:lint']],
    ]);
    expect(paletteSections('/re', catalogue).map((section) => [section.section, names(section.commands)])).toEqual([
      [null, ['release-notes', 'review', 'git:preview', 'demo-tools:lint']],
    ]);
    expect(paletteSections('/zzz', catalogue)).toEqual([]);
    expect(paletteSections('/review now', catalogue)).toEqual([]);
    // A name typed in full stays offered: picking it is how it runs.
    expect(names(paletteSections('/model', catalogue)[0]?.commands ?? [])).toEqual(['model']);
  });
});

describe('picking a command', () => {
  it('sends one that takes nothing at once', () => {
    expect(pickSlashCommand(command('usage'))).toEqual({ action: 'send', text: '/usage' });
    expect(pickSlashCommand(command('x', 'builtin', '', '   '))).toEqual({ action: 'send', text: '/x' });
  });

  // Enter in the terminal runs these: their argument is one they can do without.
  it('sends one whose argument is optional, bracketed or said to be', () => {
    expect(pickSlashCommand(command('summarise', 'builtin', '', '<optional custom instructions>'))).toEqual({ action: 'send', text: '/summarise' });
    expect(pickSlashCommand(command('model', 'builtin', '', '[model]'))).toEqual({ action: 'send', text: '/model' });
    expect(pickSlashCommand(command('review', 'commands', '', '[pr]'))).toEqual({ action: 'send', text: '/review' });
    expect(pickSlashCommand(command('autocompact', 'builtin', '', '[auto|<tokens>]'))).toEqual({ action: 'send', text: '/autocompact' });
  });

  // Its hint is a getter in the bundle, read as none: it sends, and its panel opens.
  it('sends /effort, as the static list and the binary both give it no hint', () => {
    const effort = CLAUDE_BUILTINS.find((entry) => entry.name === 'effort')!;
    expect(effort.argumentHint).toBeNull();
    expect(pickSlashCommand(effort)).toEqual({ action: 'send', text: '/effort' });
  });

  it('fills one that cannot run without its argument and shows what goes there', () => {
    expect(pickSlashCommand(command('add-dir', 'builtin', '', '<path>'))).toEqual({ action: 'fill', text: '/add-dir ', placeholder: '<path>' });
    expect(pickSlashCommand(command('demo-tools:lint', 'plugins', '', ' <path> '))).toEqual({ action: 'fill', text: '/demo-tools:lint ', placeholder: '<path>' });
    expect(hintRequiresArgument('<Optional thing>')).toBe(false);
    expect(hintRequiresArgument(null)).toBe(false);
  });

  // One tap on a short list must not end the agent or delete the session.
  it.each(['exit', 'quit', 'logout', 'restart', 'stop', 'clear', 'delete', 'archive'])('fills /%s rather than sending it', (name) => {
    expect(pickSlashCommand(command(name, 'builtin', '', null))).toEqual({ action: 'fill', text: `/${name}`, placeholder: '' });
    expect(DESTRUCTIVE_COMMANDS.has(name)).toBe(true);
  });

  it('fills every destructive command either agent lists', () => {
    for (const entry of [...CLAUDE_BUILTINS, ...CODEX_BUILTINS].filter((item) => DESTRUCTIVE_COMMANDS.has(item.name))) {
      expect(pickSlashCommand(entry).action).toBe('fill');
    }
  });

  // The review of #160: one tap committed, opened a PR, wrote CLAUDE.md or
  // compacted the conversation.
  it.each(['commit', 'pr', 'commit-push-pr', 'compact', 'init', 'new'])('fills /%s, which writes, publishes or rewrites', (name) => {
    expect(pickSlashCommand(command(name, 'builtin', 'Something', '[guidance]'))).toEqual({ action: 'fill', text: `/${name}`, placeholder: '' });
    expect(SIDE_EFFECT_COMMANDS.has(name)).toBe(true);
  });

  it('fills one whose description says it commits, pushes, resets, deletes or overwrites', () => {
    for (const description of ['Commit the current changes', 'Push your components to the registry', 'Reset the sandbox', 'Deletes old branches', 'Overwrite the lockfile']) {
      expect(describesSideEffect(description)).toBe(true);
      expect(pickSlashCommand(command('custom', 'commands', description)).action).toBe('fill');
    }
    // Words that only contain one: not a side effect.
    for (const description of ['See the uncommitted changes', 'Show the pushback log', 'Choose the model']) {
      expect(describesSideEffect(description)).toBe(false);
    }
    expect(describesSideEffect(undefined)).toBe(false);
  });

  it('fills Claude’s /commit, /pr and /init, and Codex’s /new and /init, as either list gives them', () => {
    const claude = (name: string) => CLAUDE_BUILTINS.find((entry) => entry.name === name)!;
    const codex = (name: string) => CODEX_BUILTINS.find((entry) => entry.name === name)!;
    for (const entry of [claude('commit'), claude('pr'), claude('init'), claude('compact'), codex('new'), codex('init')]) {
      expect(fillsOnPick(entry)).toBe(true);
      expect(pickSlashCommand(entry).action).toBe('fill');
    }
    expect(fillsOnPick(claude('model'))).toBe(false);
  });

  // Grok runs a command when it is picked; the ones that end or throw away
  // the session are filled, never sent from a tap.
  it("fills Grok's commands that end or throw away the session", () => {
    const grok = (name: string) => GROK_BUILTINS.find((entry) => entry.name === name)!;
    for (const name of ['new', 'quit', 'home', 'delete', 'logout', 'compact']) {
      expect(pickSlashCommand(grok(name)).action).toBe('fill');
    }
    expect(pickSlashCommand(grok('context')).action).toBe('send');
    expect(new Set(GROK_BUILTINS.map((entry) => entry.name)).size).toBe(GROK_BUILTINS.length);
  });

  // Antigravity's menu, from its own registry: the commands that end the
  // conversation or the CLI are filled, the rest run on a tap.
  it("offers Antigravity's commands, and fills those that end the conversation", () => {
    expect(catalogueFor(null, 'agy', null).map((entry) => entry.name)).toEqual(AGY_BUILTINS.map((entry) => entry.name));
    const agy = (name: string) => AGY_BUILTINS.find((entry) => entry.name === name)!;
    for (const name of ['clear', 'exit', 'logout']) expect(pickSlashCommand(agy(name)).action).toBe('fill');
    expect(pickSlashCommand(agy('context')).action).toBe('send');
    expect(pickSlashCommand(agy('codesearch'))).toEqual({ action: 'fill', text: '/codesearch ', placeholder: '<query>' });
    expect(new Set(AGY_BUILTINS.map((entry) => entry.name)).size).toBe(AGY_BUILTINS.length);
  });
});

describe('the folders the periodic scan re-reads', () => {
  const agent = (kind: 'claude' | 'codex' | null, cwd: string) => ({ agent: kind, cwd });

  it('are the open Claude agents’ folders, each once, bounded', () => {
    expect(projectFoldersToScan([agent('claude', '/a'), agent('claude', '/a'), agent('codex', '/c'), agent(null, '/n'), agent('claude', ''), agent('claude', '/b')]))
      .toEqual(['/a', '/b']);
    const many = Array.from({ length: MAX_PROJECTS_PER_SCAN + 3 }, (_, i) => agent('claude', `/p${i}`));
    expect(projectFoldersToScan(many)).toHaveLength(MAX_PROJECTS_PER_SCAN);
  });
});

describe('the cached catalogue', () => {
  const scan = (overrides: Partial<ScanResult>): ScanResult => ({ builtins: null, binary: undefined, user: null, plugins: null, projects: {}, ...overrides });

  it('stands in with the static list before any scan, and for Codex always', () => {
    expect(catalogueFor(null, 'claude', '/w').map((entry) => entry.name)).toEqual(
      [...CLAUDE_BUILTINS].sort((a, b) => (a.section === b.section ? 0 : a.section === 'builtin' ? -1 : 1)).map((entry) => entry.name)
    );
    expect(catalogueFor(null, 'codex', null)).toEqual(CODEX_BUILTINS);
    expect(catalogueFor(emptyCatalogueCache(), 'grok', '/w')).toEqual(GROK_BUILTINS);
    expect(catalogueFor(emptyCatalogueCache(), 'claude', null).length).toBe(CLAUDE_BUILTINS.length);
  });

  it('merges a host scan, then keeps the built-ins when the binary is unchanged', () => {
    const now = 5_000;
    const first = applyScan(emptyCatalogueCache(), scan({
      binary: '/b/claude 1,2',
      builtins: { kind: 'read', commands: [command('compact')] },
      user: [command('review', 'commands')],
      plugins: [command('demo-tools:lint', 'plugins')],
      projects: { '/w': [command('deploy', 'skills')] },
    }), now);
    expect(first.binary).toBe('/b/claude 1,2');
    expect(first.hostScannedAt).toBe(now);
    expect(catalogueFor(first, 'claude', '/w').map((entry) => entry.name)).toEqual(['compact', 'deploy', 'review', 'demo-tools:lint']);
    expect(catalogueFor(first, 'claude', '/other').map((entry) => entry.name)).toEqual(['compact', 'review', 'demo-tools:lint']);

    const second = applyScan(first, scan({ binary: '/b/claude 1,2', builtins: { kind: 'unchanged' }, user: [], plugins: [] }), now + 1);
    expect(second.builtins).toEqual(first.builtins);
    expect(second.user).toEqual([]);
    expect(second.projects['/w']).toEqual(first.projects['/w']);
  });

  it('keeps everything on a project-only scan but that project', () => {
    const held = applyScan(emptyCatalogueCache(), scan({ binary: 'b 1,1', builtins: { kind: 'read', commands: [command('compact')] }, user: [command('a', 'commands')], plugins: [] }), 1);
    const next = applyScan(held, scan({ projects: { '/w': [] } }), 2);
    expect(next.user).toEqual(held.user);
    expect(next.hostScannedAt).toBe(1);
    expect(projectScanned(next, '/w')).toBe(true);
    expect(projectScanned(held, '/w')).toBe(false);
    expect(projectScanned(null, '/w')).toBe(false);
  });

  // A grep stopped at its deadline: the held built-ins and binary stay, so the
  // next due scan reads the new binary again instead of answering "unchanged".
  it('keeps the held built-ins and binary when the grep failed', () => {
    const held = applyScan(emptyCatalogueCache(), scan({ binary: 'b 1,1', builtins: { kind: 'read', commands: [command('compact')] }, user: [], plugins: [] }), 1);
    const next = applyScan(held, scan({ binary: 'b 2,2', builtins: null, user: [], plugins: [] }), 2);
    expect(next.binary).toBe('b 1,1');
    expect(next.builtins).toEqual(held.builtins);
    expect(next.hostScannedAt).toBe(2);
  });

  // The review of #160: a grep that hit its deadline was not recorded, so the
  // same slow grep ran again on every ten-minute scan.
  it('records a failed grep with its time, and names that binary as held until the retry window passes', () => {
    const held = applyScan(emptyCatalogueCache(), scan({ binary: 'b 1,1', builtins: { kind: 'read', commands: [command('compact')] }, user: [], plugins: [] }), 1);
    expect(knownBinaryFor(held, 2)).toBe('b 1,1');
    const failed = applyScan(held, scan({ binary: 'b 2,2', builtins: null, grepFailed: true, user: [], plugins: [] }), 1_000);
    expect(failed.grepFailed).toEqual({ binary: 'b 2,2', at: 1_000 });
    expect(failed.binary).toBe('b 1,1');
    expect(failed.builtins).toEqual(held.builtins);
    // The next scans tell the host it holds b 2,2: an unchanged binary skips the grep…
    expect(knownBinaryFor(failed, 1_000 + SLASH_SCAN_INTERVAL_MS)).toBe('b 2,2');
    const skipped = applyScan(failed, scan({ binary: 'b 2,2', builtins: { kind: 'unchanged' }, user: [], plugins: [] }), 1_000 + SLASH_SCAN_INTERVAL_MS);
    expect(skipped.builtins).toEqual(held.builtins);
    expect(skipped.grepFailed).toEqual(failed.grepFailed);
    // …until the window has passed, when the binary read is named again and the grep retried.
    expect(knownBinaryFor(skipped, 1_000 + SLASH_GREP_RETRY_MS)).toBe('b 1,1');
    const read = applyScan(skipped, scan({ binary: 'b 2,2', builtins: { kind: 'read', commands: [command('model')] }, user: [], plugins: [] }), 1_000 + SLASH_GREP_RETRY_MS);
    expect(read.grepFailed).toBeNull();
    expect(read.binary).toBe('b 2,2');
    expect(knownBinaryFor(null, 0)).toBeNull();
  });

  it('keeps a failed grep across a relaunch, and reads a cache stored before it existed', () => {
    const failed = applyScan(emptyCatalogueCache(), scan({ binary: 'b 2,2', builtins: null, grepFailed: true, user: [], plugins: [] }), 7);
    expect(deserializeCatalogueCache(serializeCatalogueCache(failed))?.grepFailed).toEqual({ binary: 'b 2,2', at: 7 });
    const { grepFailed: _, ...older } = emptyCatalogueCache();
    expect(deserializeCatalogueCache(JSON.stringify(older))?.grepFailed).toBeNull();
  });

  it('remembers the binary read even when it held no literals, so it is not grepped again', () => {
    const next = applyScan(emptyCatalogueCache(), scan({ binary: 'b 1,1', builtins: { kind: 'read', commands: [] }, user: [], plugins: [] }), 1);
    expect(next.binary).toBe('b 1,1');
    expect(catalogueFor(next, 'claude', null).length).toBe(CLAUDE_BUILTINS.length);
  });

  it('forgets the oldest folders past its bound', () => {
    let cache = emptyCatalogueCache();
    for (let i = 0; i <= MAX_CACHED_PROJECTS; i += 1) cache = applyScan(cache, scan({ projects: { [`/p${i}`]: [] } }), i);
    expect(Object.keys(cache.projects)).toHaveLength(MAX_CACHED_PROJECTS);
    expect(projectScanned(cache, '/p0')).toBe(false);
    // Scanned again, a folder is the newest.
    cache = applyScan(cache, scan({ projects: { '/p1': [] } }), 99);
    cache = applyScan(cache, scan({ projects: { '/new': [] } }), 100);
    expect(projectScanned(cache, '/p1')).toBe(true);
    expect(projectScanned(cache, '/p2')).toBe(false);
  });

  it('survives storage, and refuses what is not a cache', () => {
    const cache: SlashCatalogueCache = applyScan(emptyCatalogueCache(), scan({
      binary: '/b 1,2', builtins: { kind: 'read', commands: [command('model', 'builtin', 'Set it', '[model]')] }, user: [], plugins: [], projects: { '/w': [command('x', 'commands')] },
    }), 7);
    expect(deserializeCatalogueCache(serializeCatalogueCache(cache))).toEqual(cache);
    for (const bad of [null, undefined, '', 'nope', '[]', '{"version":2}', JSON.stringify({ ...cache, builtins: [{ name: 1 }] }), JSON.stringify({ ...cache, projects: [] })]) {
      expect(deserializeCatalogueCache(bad)).toBeNull();
    }
  });
});

describe('scanning a host', () => {
  it('is due on first use, after ten minutes, and when asked', () => {
    expect(slashScanDue(null, 0)).toBe(true);
    expect(slashScanDue(1_000, 1_000 + SLASH_SCAN_INTERVAL_MS - 1)).toBe(false);
    expect(slashScanDue(1_000, 1_000 + SLASH_SCAN_INTERVAL_MS)).toBe(true);
  });

  const transport = (exec: HerdrTransport['exec']): HerdrTransport => ({
    exec,
    async *streamLines() {},
  });

  it('states its deadline, and asks nothing when there is nothing to ask', async () => {
    const seen: number[] = [];
    const host = new DemoHost();
    const counting = transport(async (cmd, timeout) => {
      seen.push(timeout);
      return host.exec(cmd, timeout);
    });
    expect(await scanSlashCommands(counting, { host: false, cwds: [], knownBinary: null })).toBeNull();
    expect(seen).toEqual([]);
    expect(await scanSlashCommands(counting, { host: true, cwds: [], knownBinary: null })).not.toBeNull();
    expect(seen).toEqual([SLASH_SCAN_TIMEOUT_MS]);
  });

  it('is null, never a throw, when the host fails', async () => {
    const failing: ExecResult = { ok: false, code: 'timeout', message: 'slow' };
    expect(await scanSlashCommands(transport(async () => failing), { host: true, cwds: [], knownBinary: null })).toBeNull();
    expect(await scanSlashCommands(transport(async () => ({ ok: true, stdout: '', stderr: '', exitCode: 1 })), { host: true, cwds: [], knownBinary: null })).toBeNull();
    expect(await scanSlashCommands(transport(async () => { throw new Error('boom'); }), { host: true, cwds: [], knownBinary: null })).toBeNull();
  });
});

describe('the Demo’s catalogue', () => {
  it('answers the script: five built-ins (one hidden left out), a command, a skill, a project command, a plugin', async () => {
    const host = new DemoHost();
    const result = await scanSlashCommands(host, { host: true, cwds: [DEMO_NOTES_CWD], knownBinary: null });
    expect(result?.binary).toBe(`${DEMO_CLAUDE_BINARY} ${DEMO_CLAUDE_BINARY_STAT}`);
    const cache = applyScan(emptyCatalogueCache(), result!, 1);
    const listed = catalogueFor(cache, 'claude', DEMO_NOTES_CWD).map((entry) => [entry.section, entry.name, entry.argumentHint, entry.description]);
    expect(listed).toEqual([
      ['builtin', 'add-dir', '<path>', 'Let the agent work in one more folder'],
      ['builtin', 'compact', '<optional instructions for the summary>', 'Summarise the conversation to make room in the context'],
      ['builtin', 'effort', null, 'Choose how hard the model thinks'],
      ['builtin', 'model', '[model]', 'Choose the model'],
      ['builtin', 'usage', null, 'Cost, plan usage and activity for this session'],
      ['skills', 'release-notes', null, 'Write release notes from the git log'],
      ['commands', 'notes:summarise', null, 'Summarise the notes in this folder into three bullets.'],
      ['commands', 'review', '[pr]', 'Review the open pull request'],
      ['plugins', 'demo-tools:lint', null, 'Lint the files changed on this branch'],
    ]);

    const again = await scanSlashCommands(host, { host: true, cwds: [], knownBinary: cache.binary });
    expect(again?.builtins).toEqual({ kind: 'unchanged' });
    expect(catalogueFor(applyScan(cache, again!, 2), 'claude', DEMO_NOTES_CWD)).toEqual(catalogueFor(cache, 'claude', DEMO_NOTES_CWD));
  });

  it('has no project commands outside the notes folder', async () => {
    const result = await scanSlashCommands(new DemoHost(), { host: false, cwds: ['/home/demo/app'], knownBinary: null });
    expect(result?.projects).toEqual({ '/home/demo/app': [] });
  });
});
