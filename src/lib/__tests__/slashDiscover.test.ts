import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { binaryKey, discoveryCommand, discoveryScript, SLASH_BEGIN, SLASH_END, type ScanRequest } from '../slashCommands/discover';
import { parseScanOutput, type ScanResult } from '../slashCommands/parse';
import { dedupeCommands } from '../slashCommands/parse';
import { SLASH_SCAN_GREP_TIMEOUT_S } from '../herdr/timeouts';

const FIXTURES = join(__dirname, 'fixtures', 'slashCommands');

describe('the discovery script, as a string', () => {
  it('frames its answer and asks only for what was requested', () => {
    const hostOnly = discoveryScript({ host: true, cwds: [], knownBinary: null });
    expect(hostOnly).toContain(`echo ${SLASH_BEGIN}`);
    expect(hostOnly).toContain(SLASH_END);
    expect(hostOnly).toMatch(new RegExp(`^\\s*hs_builtins '' ${SLASH_SCAN_GREP_TIMEOUT_S}$`, 'm'));
    expect(hostOnly).toMatch(/^\s*hs_user$/m);
    expect(hostOnly).toMatch(/^\s*hs_plugins$/m);
    expect(hostOnly).not.toMatch(/^\s*hs_project /m);

    const projectOnly = discoveryScript({ host: false, cwds: ['/srv/app'], knownBinary: null });
    expect(projectOnly).not.toMatch(/^\s*hs_(builtins|user|plugins)( |$)/m);
    expect(projectOnly).toMatch(/^\s*hs_project '\/srv\/app'$/m);
  });

  // The lesson of b704ec8: nothing may walk a deep tree or run unbounded.
  it('stays bounded: no deep find, no walk of the plugins folder, a deadline on the grep', () => {
    const script = discoveryScript({ host: true, cwds: ['/a'], knownBinary: null });
    for (const depth of script.matchAll(/-maxdepth (\d+)/g)) expect(Number(depth[1])).toBeLessThanOrEqual(3);
    expect(script).not.toMatch(/find[^\n]*plugins"?\s/);
    // Every grep over the binary under a deadline the host enforces itself.
    expect(script).toMatch(/hs_builtins '' \d+$/m);
    for (const grep of script.matchAll(/^.*grep -a -o -E "\$hs_(re|nt)" "\$hs_b".*$/gm)) expect(grep[0]).toMatch(/hs_bounded "\$2" grep/);
    expect(script).toContain('perl -e \'alarm shift @ARGV; exec @ARGV');
    expect(script).toMatch(/\} \| head -c \d+\n/);
    // Nothing GNU-only, and no glob (an unmatched one aborts zsh).
    expect(script).not.toMatch(/-printf|grep -P|\bfor \w+ in /);
  });

  it('quotes a folder with a quote and a space in it', () => {
    const script = discoveryScript({ host: false, cwds: ["/srv/it's mine"], knownBinary: "/x/claude 1,2" });
    expect(script).toContain(`hs_project '/srv/it'\\''s mine'`);
  });

  it('is wrapped for sh with the full PATH', () => {
    expect(discoveryCommand({ host: true, cwds: [], knownBinary: null })).toMatch(/^export PATH=.*; sh -c '/);
  });
});

/** A scratch host: a home with a Claude config, a fake `claude`, plugins and a project. */
function scratchHost(): { home: string; project: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'herdrchat-slash-'));
  const write = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  // The binary: two kilobytes of the real Claude Code 2.1.296 bundle.
  mkdirSync(join(home, '.local/bin'), { recursive: true });
  // Then the bundle's name table and a skill that names itself through it
  // (`zs({name:M7t,…})`, `M7t="simplify"`).
  writeFileSync(
    join(home, '.local/bin/claude'),
    Buffer.concat([
      readFileSync(join(FIXTURES, 'claude-2.1.296-excerpt.txt')),
      readFileSync(join(FIXTURES, 'claude-2.1.296-simplify-excerpt.txt')),
    ])
  );
  chmodSync(join(home, '.local/bin/claude'), 0o755);

  const claude = join(home, '.claude');
  write(join(claude, 'commands/review.md'), '---\ndescription: Review the open pull request\nargument-hint: "[pr]"\n---\nBody\n');
  write(join(claude, 'commands/git/push.md'), 'Push the branch\n');
  write(join(claude, 'commands/a/b/c/too-deep.md'), 'Never read: below -maxdepth 3\n');
  write(join(claude, 'skills/mind/SKILL.md'), '---\nname: mind\ndescription: >\n  Read and write\n  the vault\n---\n# Mind\n');
  write(join(claude, 'skills/quiet/SKILL.md'), '---\ndescription: Only for the model\nuser-invocable: false\n---\n');
  mkdirSync(join(claude, 'skills/no-skill-file'), { recursive: true });
  // A skill reached through a symlink, as ~/.claude/skills/herdr is on Gimel.
  write(join(home, 'elsewhere/herdr/SKILL.md'), '---\ndescription: Control Herdr\n---\n');
  symlinkSync(join(home, 'elsewhere/herdr'), join(claude, 'skills/herdr'));

  const plugin = join(claude, 'plugins/cache/market/demo-tools/1.0.0');
  write(join(plugin, '.claude-plugin/plugin.json'), '{\n  "name": "demo-tools",\n  "author": { "name": "Someone" }\n}\n');
  write(join(plugin, 'commands/lint.md'), '---\ndescription: Lint the branch\n---\n');
  write(join(plugin, 'skills/fmt/SKILL.md'), '---\ndescription: Format the code\n---\n');
  const bare = join(claude, 'plugins/cache/market/swift-lsp/2.0.0');
  mkdirSync(bare, { recursive: true });
  write(
    join(claude, 'plugins/installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'demo-tools@market': [{ scope: 'user', installPath: plugin }],
        'swift-lsp@market': [{ scope: 'user', installPath: bare }],
        'gone@market': [{ scope: 'user', installPath: join(claude, 'plugins/cache/market/gone/1.0.0') }],
      },
    }, null, 2)
  );

  const project = join(home, "work/it's mine");
  write(join(project, '.claude/commands/notes/summarise.md'), '# Summarise the notes\n\nMore.\n');
  write(join(project, '.claude/commands/review.md'), '---\ndescription: The project review\n---\n');
  write(join(project, '.claude/skills/deploy/SKILL.md'), '---\ndescription: Deploy it\nargument-hint: <env>\n---\n');
  return { home, project, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

const SHELLS = ['sh', ...(existsSync('/bin/zsh') || existsSync('/usr/bin/zsh') ? ['zsh'] : [])];

describe.each(SHELLS)('the discovery script under %s', (shell) => {
  let host: ReturnType<typeof scratchHost>;
  beforeAll(() => {
    host = scratchHost();
  });
  afterAll(() => host.cleanup());

  const run = (request: ScanRequest): ScanResult => {
    const stdout = execFileSync(shell, ['-c', discoveryScript(request)], {
      env: { ...process.env, HOME: host.home, CLAUDE_CONFIG_DIR: '', PATH: `${host.home}/.local/bin:/usr/bin:/bin` },
      encoding: 'utf8',
    });
    const parsed = parseScanOutput(stdout, request);
    expect(parsed).not.toBeNull();
    return parsed!;
  };

  it('reads the built-ins out of real bytes of the binary, and the files on disk', () => {
    const result = run({ host: true, cwds: [host.project], knownBinary: null });
    expect(result.binary).toMatch(new RegExp(`^${host.home}/\\.local/bin/claude \\d+,\\d+$`));
    expect(result.builtins?.kind).toBe('read');
    const builtins = result.builtins?.kind === 'read' ? result.builtins.commands : [];
    expect(builtins.map((command) => [command.name, command.argumentHint])).toEqual([
      ['autocompact', '[auto|<tokens>]'],
      ['compact', '<optional custom summarization instructions>'],
      ['config', '[key=value]'],
      ['output-style', '[style]'],
      ['simplify', '[<target>]'],
    ]);
    expect(builtins.find((command) => command.name === 'simplify')).toMatchObject({
      description: 'Clean up the changed code without changing behavior',
      section: 'skills',
      source: 'bundled',
    });

    const names = (list: { name: string }[] | null | undefined) => (list ?? []).map((command) => command.name).sort();
    expect(names(result.user)).toEqual(['git:push', 'herdr', 'mind', 'review']);
    expect(result.user?.find((command) => command.name === 'mind')?.description).toBe('Read and write the vault');
    expect(names(result.plugins)).toEqual(['demo-tools:fmt', 'demo-tools:lint']);
    expect(names(result.projects[host.project])).toEqual(['deploy', 'notes:summarise', 'review']);
    expect(result.projects[host.project]?.find((command) => command.name === 'notes:summarise')?.description).toBe('Summarise the notes');
  });

  it('skips the grep when the binary is the one already read', () => {
    const first = run({ host: true, cwds: [], knownBinary: null });
    const again = run({ host: true, cwds: [], knownBinary: first.binary ?? null });
    expect(again.builtins).toEqual({ kind: 'unchanged' });
    expect(again.binary).toBe(first.binary);
  });

  it('says so when there is no claude to read, and still reads the files', () => {
    const request = { host: true, cwds: [], knownBinary: null };
    const stdout = execFileSync(shell, ['-c', discoveryScript(request)], {
      env: { ...process.env, HOME: join(host.home, 'nowhere'), CLAUDE_CONFIG_DIR: join(host.home, '.claude'), PATH: '/usr/bin:/bin' },
      encoding: 'utf8',
    });
    const result = parseScanOutput(stdout, request)!;
    expect(result.binary).toBeNull();
    expect(result.builtins).toEqual({ kind: 'read', commands: [] });
    expect(result.user?.length).toBe(4);
  });

  // The review of 4d5c706: a grep cut by its deadline printed the built-ins'
  // end anyway, so a partial read was cached against the binary for good.
  describe('when the grep over the binary is slow', () => {
    const tools = ['head', 'sed', 'find', 'stat', 'cut', 'tr', 'sort', 'awk', 'mktemp', 'rm', 'sleep', 'cat'];
    let bin: string;
    beforeAll(() => {
      bin = join(host.home, `slow-${shell}`);
      mkdirSync(bin, { recursive: true });
      const realGrep = execFileSync('sh', ['-c', 'command -v grep'], { encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' } }).trim();
      // Slow only over the binary; any other grep is the real one.
      writeFileSync(
        join(bin, 'grep'),
        `#!/bin/sh
for a in "$@"; do case "$a" in */claude) exec sleep 30 ;; esac; done
exec ${realGrep} "$@"
`
      );
      chmodSync(join(bin, 'grep'), 0o755);
      for (const tool of tools) {
        const path = execFileSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' } }).trim();
        symlinkSync(path, join(bin, tool));
      }
      symlinkSync(join(host.home, '.local/bin/claude'), join(bin, 'claude'));
    });

    const scan = (path: string) => {
      const request: ScanRequest = { host: true, cwds: [], knownBinary: null, grepDeadlineS: 1 };
      const started = Date.now();
      const shellPath = execFileSync('sh', ['-c', `command -v ${shell}`], { encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' } }).trim();
      const stdout = execFileSync(shellPath, ['-c', discoveryScript(request)], {
        env: { ...process.env, HOME: host.home, CLAUDE_CONFIG_DIR: '', PATH: path },
        encoding: 'utf8',
      });
      return { result: parseScanOutput(stdout, request)!, stdout, seconds: (Date.now() - started) / 1000 };
    };

    // This host's own way: timeout(1) on Linux, Perl's alarm on a Mac.
    it('stops it at the deadline and says nothing was read', () => {
      const { result, stdout, seconds } = scan(`${bin}:/usr/bin:/bin`);
      expect(seconds).toBeLessThan(10);
      expect(stdout).toContain('HERDRCHAT_SLASH_BUILTINS_FAILED');
      expect(stdout).not.toContain('HERDRCHAT_SLASH_BUILTINS\n');
      expect(result.builtins).toBeNull();
      expect(result.binary).toMatch(/claude \d+,\d+$/);
      // The rest of the host's part still arrives.
      expect(result.user?.length).toBe(4);
    }, 20_000);

    // A host with neither timeout(1) nor Perl: the watchdog.
    it('stops it with the watchdog where there is no timeout(1) and no Perl', () => {
      const { result, stdout, seconds } = scan(bin);
      expect(seconds).toBeLessThan(10);
      expect(stdout).toContain('HERDRCHAT_SLASH_BUILTINS_FAILED');
      expect(result.builtins).toBeNull();
      expect(result.user?.length).toBe(4);
    }, 20_000);
  });

  it('answers a project-only scan with the project alone, a folder with nothing as empty', () => {
    const empty = join(host.home, 'empty');
    mkdirSync(empty, { recursive: true });
    const result = run({ host: false, cwds: [host.project, empty], knownBinary: null });
    expect(result.builtins).toBeNull();
    expect(result.user).toBeNull();
    expect(result.projects[empty]).toEqual([]);
    expect(result.projects[host.project]?.length).toBe(3);
  });
});

// This Mac's own ~/.claude and Claude Code. Skipped where either is missing
// (CI); what it pins is that the script reads a real layout, not a scratch one.
const realClaude = (() => {
  try {
    return realpathSync(execFileSync('sh', ['-c', 'export PATH="$HOME/.local/bin:$PATH"; command -v claude'], { encoding: 'utf8' }).trim());
  } catch {
    return null;
  }
})();
const local = process.env.CI === undefined && realClaude !== null && existsSync(join(homedir(), '.claude')) ? describe : describe.skip;

local('the discovery script on this Mac', () => {
  it('lists the installed Claude Code’s built-ins and the person’s skills', () => {
    const request = { host: true, cwds: [], knownBinary: null };
    const stdout = execFileSync('sh', ['-c', discoveryCommand(request)], { encoding: 'utf8', maxBuffer: 1 << 24 });
    const result = parseScanOutput(stdout, request)!;
    expect(result).not.toBeNull();
    const builtins = result.builtins?.kind === 'read' ? result.builtins.commands : [];
    expect(builtins.length).toBeGreaterThan(50);
    const compact = builtins.find((command) => command.name === 'compact');
    expect(compact?.description).toMatch(/context/i);
    expect(builtins.some((command) => command.name === 'extra-usage')).toBe(false);
    for (const name of ['simplify', 'loop', 'code-review', 'schedule']) expect(builtins.map((command) => command.name)).toContain(name);
    const all = dedupeCommands([...builtins, ...(result.user ?? []), ...(result.plugins ?? [])]);
    expect(all.length).toBeGreaterThan(builtins.length - 1);

    if (realClaude?.endsWith('/2.1.296')) {
      // The version the fixture was taken from: the grep's answer is the fixture.
      const between = stdout.split('HERDRCHAT_SLASH_BUILTINS\n')[1]?.split('HERDRCHAT_SLASH_BUILTINS_END')[0];
      expect(between).toBe(readFileSync(join(FIXTURES, 'claude-2.1.296-literals.txt'), 'utf8'));
    }
  }, 60_000);

  it('reads the version once: the next scan sends the signature and skips the grep', () => {
    const first = parseScanOutput(
      execFileSync('sh', ['-c', discoveryCommand({ host: true, cwds: [], knownBinary: null })], { encoding: 'utf8', maxBuffer: 1 << 24 }),
      { host: true, cwds: [] }
    )!;
    expect(first.binary).toMatch(/ \d+,\d+$/);
    const [path = '', signature = ''] = (first.binary ?? '').split(' ');
    const again = parseScanOutput(
      execFileSync('sh', ['-c', discoveryCommand({ host: true, cwds: [], knownBinary: binaryKey(path, signature) })], { encoding: 'utf8' }),
      { host: true, cwds: [] }
    )!;
    expect(again.builtins).toEqual({ kind: 'unchanged' });
  }, 60_000);
});
