import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLAUDE_BUILTINS } from '../slashCommands/builtins';
import {
  SLASH_BEGIN,
  SLASH_BINARY,
  SLASH_BUILTINS,
  SLASH_BUILTINS_END,
  SLASH_BUILTINS_UNCHANGED,
  SLASH_END,
  SLASH_FILE,
  SLASH_FILE_END,
  SLASH_NO_BINARY,
  SLASH_PLUGIN,
} from '../slashCommands/discover';
import {
  dedupeCommands,
  fileCommand,
  getterDescription,
  parseBuiltinLiteral,
  parseBuiltins,
  parseFrontmatter,
  parseScanOutput,
  pluginNameFromPath,
  type FileRecord,
} from '../slashCommands/parse';
import type { CatalogueCommand } from '../slashCommands/types';

const LITERALS = readFileSync(join(__dirname, 'fixtures', 'slashCommands', 'claude-2.1.296-literals.txt'), 'utf8');

describe('a command literal out of the binary', () => {
  it('reads a plain description and hint', () => {
    expect(parseBuiltinLiteral(
      'type:"local",name:"compact",description:"Free up context by summarizing the conversation so far",isEnabled:()=>!Ne(process.env.DISABLE_COMPACT),supportsNonInteractive:!0,argumentHint:"<optional custom summarization instructions>",thinClientDispatch:"post-text"'.replace(/^/, '{')
    )).toEqual({
      name: 'compact',
      type: 'local',
      description: 'Free up context by summarizing the conversation so far',
      argumentHint: '<optional custom summarization instructions>',
      hidden: false,
    });
  });

  it('shows no hint for a computed one', () => {
    const effort = parseBuiltinLiteral('{type:"local-jsx",name:"effort",description:"Set effort level for model usage",get argumentHint(){return Mjt("[","]")},immediate:!0');
    expect(effort?.argumentHint).toBeNull();
    expect(effort?.description).toBe('Set effort level for model usage');
  });

  it('reads a computed description down to its fixed words', () => {
    expect(parseBuiltinLiteral('{type:"local-jsx",name:"model",get description(){return`Set the AI model for Claude Code (currently ${qo(tt())})`},argumentHint:"[model]"')?.description)
      .toBe('Set the AI model for Claude Code');
    expect(getterDescription('return jEr()?"Switch Anthropic accounts":"Sign in with your Anthropic account"')).toBe('Sign in with your Anthropic account');
    expect(getterDescription('return`Draft an editable plan in a cloud session (${XCn().timeEstimate}) \\xB7 See ${mle}`')).toBe('Draft an editable plan in a cloud session');
    expect(getterDescription('return yjt()')).toBeNull();
  });

  it('takes keys in any order, and a bundled skill’s menu description', () => {
    expect(parseBuiltinLiteral('{name:"context",description:"Visualize current context usage as a colored grid",argumentHint:"[all]",isEnabled:()=>!ve()&&!vNt(),type:"local-jsx"'))
      .toMatchObject({ name: 'context', type: 'local-jsx', argumentHint: '[all]', hidden: false });
    expect(parseBuiltinLiteral('({name:"debug",menuDescription:"Turn on debug logging and investigate problems",description:"Enable debug logging",argumentHint:"[issue description]",userInvocable:!0,async getPromptForCommand(e,n)'))
      .toEqual({ name: 'debug', type: 'bundled', description: 'Turn on debug logging and investigate problems', argumentHint: '[issue description]', hidden: false });
  });

  it.each([
    ['isHidden:!0', '{type:"local-jsx",name:"extra-usage",description:"Renamed to /usage-credits",isHidden:!0,isEnabled:()=>pP()'],
    ['isHidden:!0 as the last key', '{type:"local-jsx",name:"pro-trial-expired",description:"Options",isHidden:!0'],
    ['a literal false isEnabled', '{type:"local-jsx",name:"loops",description:"List, create, and delete loops",immediate:!0,isEnabled:()=>!1'],
    ['a skill the person cannot invoke', '({name:"x",description:"y",userInvocable:!1,async getPromptForCommand()'],
  ])('marks hidden: %s', (_, literal) => {
    expect(parseBuiltinLiteral(literal)?.hidden).toBe(true);
  });

  it('leaves out what is not a command', () => {
    expect(parseBuiltinLiteral('{name:"Bash",description:"Run a command",inputSchema:x')).toBeNull();
    expect(parseBuiltinLiteral('{type:"text",name:"x"')).toBeNull();
    expect(parseBuiltinLiteral('garbage')).toBeNull();
  });

  it('decodes escapes', () => {
    expect(parseBuiltinLiteral('{type:"local",name:"goal",description:"Set a goal \\u2014 keep working"')?.description).toBe('Set a goal — keep working');
  });
});

describe('the built-ins of Claude Code 2.1.296', () => {
  const builtins = parseBuiltins(LITERALS);

  // The grep the spec measured: 121 `type:"…",name:"…"` pairs in this bundle.
  it('come from the 121 command literals the bundle has in its usual shape, and more', () => {
    const pairs = new Set([...LITERALS.matchAll(/type:"(local|local-jsx|prompt)",name:"([a-z0-9-]+)"/g)].map((m) => `${m[1]} ${m[2]}`));
    expect(pairs.size).toBe(121);
    expect(builtins).toHaveLength(106);
    expect(builtins.filter((command) => command.source === 'bundled')).toHaveLength(12);
  });

  it('are the static list, which stands in when the binary cannot be read', () => {
    expect(builtins).toEqual(CLAUDE_BUILTINS);
  });

  it('leave out the hidden and the disabled', () => {
    const names = builtins.map((command) => command.name);
    for (const hidden of ['extra-usage', 'pro-trial-expired', 'agents', 'heapdump', 'design-consent', 'loops', 'version', 'wellbeing']) {
      expect(names).not.toContain(hidden);
    }
  });

  it('list one entry per name, the interactive literal speaking for it', () => {
    const byName = new Map(builtins.map((command) => [command.name, command]));
    expect(new Set(builtins.map((command) => command.name)).size).toBe(builtins.length);
    expect(byName.get('context')).toMatchObject({ description: 'Visualize current context usage as a colored grid', argumentHint: '[all]' });
    expect(byName.get('model')).toMatchObject({ description: 'Set the AI model for Claude Code', argumentHint: '[model]' });
    expect(byName.get('effort')).toMatchObject({ argumentHint: null });
    expect(byName.get('usage')?.description).toBe('Show session cost, plan usage, and activity stats');
    expect(byName.get('exit')?.description).toBe('Exit the CLI');
    expect(byName.get('batch')).toMatchObject({ section: 'skills', source: 'bundled' });
  });
});

describe('frontmatter', () => {
  it('reads plain, quoted, folded and literal values', () => {
    const { fields, body } = parseFrontmatter([
      '---',
      'name: mind',
      'description: >',
      '  How to read',
      '  the vault',
      'argument-hint: "[pr] \\"x\\""',
      "other: 'it''s'",
      'block: |',
      '  one',
      '  two',
      'plain: a value # a comment',
      'wrapped: first',
      '  second',
      '---',
      '# Title',
    ].join('\r\n'));
    expect(fields.get('description')).toBe('How to read the vault');
    expect(fields.get('argument-hint')).toBe('[pr] "x"');
    expect(fields.get('other')).toBe("it's");
    expect(fields.get('block')).toBe('one\ntwo');
    expect(fields.get('plain')).toBe('a value');
    expect(fields.get('wrapped')).toBe('first second');
    expect(body).toEqual(['# Title']);
  });

  it('has none without the opening line', () => {
    expect(parseFrontmatter('Just a prompt\nmore').fields.size).toBe(0);
  });
});

describe('a command or skill file', () => {
  const file = (overrides: Partial<FileRecord>): FileRecord => ({
    kind: 'command', source: 'user', owner: '-', name: 'review.md', path: '/h/.claude/commands/review.md', excerpt: '', ...overrides,
  });

  it('names a nested command with colons, the terminal’s way', () => {
    expect(fileCommand(file({ name: 'a/b.md', excerpt: 'Do the thing\n' }))).toEqual({
      name: 'a:b', description: 'Do the thing', argumentHint: null, section: 'commands', source: 'user',
    });
  });

  it('takes the first line, without its heading marks, when there is no frontmatter description', () => {
    expect(fileCommand(file({ excerpt: '\n\n## Review it\nmore' }))?.description).toBe('Review it');
    expect(fileCommand(file({ excerpt: '---\nargument-hint: <n>\n---\n\nThe body line' }))).toMatchObject({ description: 'The body line', argumentHint: '<n>' });
  });

  it('prefixes a plugin’s commands and skills with the plugin’s name', () => {
    const owner = '/h/.claude/plugins/cache/m/demo-tools/1.2.3';
    expect(fileCommand(file({ source: 'plugin', owner, name: 'lint.md' }), 'demo-tools')).toMatchObject({ name: 'demo-tools:lint', section: 'plugins' });
    expect(fileCommand(file({ source: 'plugin', owner, kind: 'skill', name: 'fmt' }))).toMatchObject({ name: 'demo-tools:fmt', section: 'plugins' });
    expect(pluginNameFromPath('/x/plugins/cache/m/swift-lsp/1.0.0')).toBe('swift-lsp');
    expect(pluginNameFromPath('/x/plugins/local/my-plugin')).toBe('my-plugin');
  });

  it('lists a skill the model may not invoke, and not one the person may not', () => {
    const skill = (excerpt: string) => fileCommand(file({ kind: 'skill', name: 'release', excerpt }));
    expect(skill('---\ndescription: Ship\ndisable-model-invocation: true\n---')).toMatchObject({ name: 'release', section: 'skills' });
    expect(skill('---\ndescription: Ship\nuser-invocable: false\n---')).toBeNull();
  });

  it('leaves out files in hidden folders and names with spaces', () => {
    expect(fileCommand(file({ name: '.trash/old.md' }))).toBeNull();
    expect(fileCommand(file({ name: 'two words.md' }))).toBeNull();
  });

  it('keeps a long description to one bounded line', () => {
    const long = fileCommand(file({ excerpt: `---\ndescription: ${'word '.repeat(200)}\n---` }))!.description;
    expect(long.length).toBeLessThanOrEqual(300);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('the script’s answer', () => {
  const record = (fields: string[], excerpt: string) => [[SLASH_FILE, ...fields].join('\t'), excerpt, '', SLASH_FILE_END];
  const frame = (...body: string[]) => ['Last login: yesterday', SLASH_BEGIN, ...body, '', SLASH_END, ''].join('\n');

  it('reads every part', () => {
    const stdout = frame(
      [SLASH_BINARY, '/b/claude', '10,20'].join('\t'),
      SLASH_BUILTINS,
      '{type:"local",name:"compact",description:"Compact it"',
      SLASH_BUILTINS_END,
      ...record(['command', 'user', '-', 'review.md', '/h/.claude/commands/review.md'], '---\ndescription: Review\n---'),
      [SLASH_PLUGIN, 'tools', '/p/tools/1.0.0'].join('\t'),
      ...record(['command', 'plugin', '/p/tools/1.0.0', 'lint.md', '/p/tools/1.0.0/commands/lint.md'], 'Lint'),
      ...record(['skill', 'project', '/w', 'deploy', '/w/.claude/skills/deploy/SKILL.md'], '---\ndescription: Deploy\n---'),
    );
    const result = parseScanOutput(stdout, { host: true, cwds: ['/w', '/empty'] })!;
    expect(result.binary).toBe('/b/claude 10,20');
    expect(result.builtins).toEqual({ kind: 'read', commands: [expect.objectContaining({ name: 'compact', description: 'Compact it' })] });
    expect(result.user?.map((command) => command.name)).toEqual(['review']);
    expect(result.plugins?.map((command) => command.name)).toEqual(['tools:lint']);
    expect(result.projects['/w']?.map((command) => command.name)).toEqual(['deploy']);
    expect(result.projects['/empty']).toEqual([]);
  });

  it('reads an unchanged binary and a missing one', () => {
    expect(parseScanOutput(frame([SLASH_BINARY, '/b/claude', '1,2'].join('\t'), SLASH_BUILTINS_UNCHANGED), { host: true, cwds: [] })!.builtins).toEqual({ kind: 'unchanged' });
    const none = parseScanOutput(frame(SLASH_NO_BINARY), { host: true, cwds: [] })!;
    expect(none.binary).toBeNull();
    expect(none.builtins).toEqual({ kind: 'read', commands: [] });
  });

  it('keeps the whole records of an answer cut short, and not the cut one', () => {
    const cut = [SLASH_BEGIN, ...record(['skill', 'user', '-', 'a', '/a'], 'A'), [SLASH_FILE, 'skill', 'user', '-', 'b', '/b'].join('\t'), '---', '', SLASH_END, ''].join('\n');
    expect(parseScanOutput(cut, { host: true, cwds: [] })!.user?.map((command) => command.name)).toEqual(['a']);
    const cutBuiltins = [SLASH_BEGIN, SLASH_BUILTINS, '{type:"local",name:"x"', '', SLASH_END].join('\n');
    expect(parseScanOutput(cutBuiltins, { host: true, cwds: [] })!.builtins).toBeNull();
  });

  it.each(['', 'sh: 1: claude: not found\n', `${SLASH_BEGIN}\nhalf an answer`, `${SLASH_END}\n${SLASH_BEGIN}\n`])('reads %j as a failed scan', (stdout) => {
    expect(parseScanOutput(stdout, { host: true, cwds: [] })).toBeNull();
  });
});

describe('one entry per name', () => {
  const entry = (name: string, source: CatalogueCommand['source'], section: CatalogueCommand['section'] = 'commands'): CatalogueCommand => ({
    name, description: source, argumentHint: null, section, source,
  });

  it('keeps project over user over plugin, a built-in over all, a bundled skill under all', () => {
    const merged = dedupeCommands([
      entry('review', 'plugin', 'plugins'),
      entry('review', 'user'),
      entry('review', 'project'),
      entry('compact', 'user'),
      entry('compact', 'builtin', 'builtin'),
      entry('run', 'bundled', 'skills'),
      entry('run', 'user', 'skills'),
    ]);
    expect(merged.map((command) => [command.name, command.source])).toEqual([
      ['compact', 'builtin'],
      ['run', 'user'],
      ['review', 'project'],
    ]);
  });

  it('orders sections, then source, then name', () => {
    const merged = dedupeCommands([
      entry('z', 'plugin', 'plugins'),
      entry('b', 'user'),
      entry('a', 'user'),
      entry('c', 'project'),
      entry('s', 'bundled', 'skills'),
      entry('t', 'user', 'skills'),
      entry('model', 'builtin', 'builtin'),
    ]);
    expect(merged.map((command) => command.name)).toEqual(['model', 't', 's', 'c', 'a', 'b', 'z']);
  });
});
