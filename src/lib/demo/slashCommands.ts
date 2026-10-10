/**
 * The demo host's slash commands: what its discovery script finds
 * (`src/lib/slashCommands/discover.ts`), answered in the script's own output
 * format so the real parser reads it.
 *
 * Its "binary" holds five built-ins in the literal shapes Claude Code 2.1.296
 * uses (a computed description, a computed hint, an optional hint, a required
 * one, none) and one hidden one that must not be listed. On disk: a user command with a hint, a
 * user skill, a project command in the notes folder (no frontmatter, so its
 * description is its first line) and a plugin with one command.
 */
import {
  SLASH_BEGIN,
  SLASH_BINARY,
  SLASH_BUILTINS,
  SLASH_BUILTINS_END,
  SLASH_BUILTINS_UNCHANGED,
  SLASH_END,
  SLASH_FILE,
  SLASH_FILE_END,
  SLASH_PLUGIN,
} from '../slashCommands/discover';
import { DEMO_HOME } from './fixtures';

export const DEMO_CLAUDE_BINARY = `${DEMO_HOME}/.local/bin/claude`;
/** `<size>,<mtime>`, as `stat` prints it. Fixed: the demo's Claude Code never updates. */
export const DEMO_CLAUDE_BINARY_STAT = '240664432,1791574242';

/** What the grep finds in the demo's binary. `extra-usage` is hidden and must not be listed. */
export const DEMO_BUILTIN_LITERALS: readonly string[] = [
  '{type:"local-jsx",name:"model",get description(){return`Set the AI model for Claude Code (currently ${qo(tt())})`},argumentHint:"[model]",immediate:!0,requires:{ink:!0},thinClientDispatch:"control-request"',
  '{type:"local-jsx",name:"effort",description:"Set effort level for model usage",get argumentHint(){return Mjt("[","]")},immediate:!0,requires:{ink:!0},thinClientDispatch:"control-request"',
  '{type:"local",name:"compact",description:"Free up context by summarizing the conversation so far",isEnabled:()=>!Ne(process.env.DISABLE_COMPACT),supportsNonInteractive:!0,argumentHint:"<optional custom summarization instructions>",thinClientDispatch:"post-text",load:()=>import("/$bunfs/root/chunk-qy8qtapj.js")',
  '{type:"local-jsx",name:"add-dir",description:"Add a new working directory",argumentHint:"<path>",immediate:(e,n)=>e.trim()!==""||n==="fullscreen",thinClientDispatch:"twin"',
  '{type:"local-jsx",name:"usage",aliases:["cost","stats"],description:"Show session cost, plan usage, and activity stats",thinClientDispatch:"control-request",immediate:!0,requires:{ink:!0}',
  '{type:"local-jsx",name:"extra-usage",description:"Renamed to /usage-credits",isHidden:!0,isEnabled:()=>pP()&&!ve(),requires:{ink:!0}',
];

export const DEMO_NOTES_CWD = `${DEMO_HOME}/notes`;
const DEMO_PLUGIN_PATH = `${DEMO_HOME}/.claude/plugins/cache/demo-market/demo-tools/1.0.0`;

interface DemoCommandFile {
  kind: 'command' | 'skill';
  source: 'user' | 'project' | 'plugin';
  owner: string;
  /** As the script prints it: a command's path under its folder, a skill's folder. */
  name: string;
  path: string;
  text: string;
}

const USER_FILES: readonly DemoCommandFile[] = [
  {
    kind: 'command',
    source: 'user',
    owner: '-',
    name: 'review.md',
    path: `${DEMO_HOME}/.claude/commands/review.md`,
    text: '---\ndescription: Review the open pull request\nargument-hint: "[pr]"\n---\n\nReview pull request $ARGUMENTS and list what should change before it merges.\n',
  },
  {
    kind: 'skill',
    source: 'user',
    owner: '-',
    name: 'release-notes',
    path: `${DEMO_HOME}/.claude/skills/release-notes/SKILL.md`,
    text: '---\nname: release-notes\ndescription: Write release notes from the git log\ndisable-model-invocation: true\n---\n\n# Release notes\n\nRead the log since the last tag and group it by what a person notices.\n',
  },
];

const PLUGIN_FILES: readonly DemoCommandFile[] = [
  {
    kind: 'command',
    source: 'plugin',
    owner: DEMO_PLUGIN_PATH,
    name: 'lint.md',
    path: `${DEMO_PLUGIN_PATH}/commands/lint.md`,
    text: '---\ndescription: Lint the files changed on this branch\n---\n\nRun the linter on the changed files.\n',
  },
];

/** Project commands, by folder. */
const PROJECT_FILES: Readonly<Record<string, readonly DemoCommandFile[]>> = {
  [DEMO_NOTES_CWD]: [
    {
      kind: 'command',
      source: 'project',
      owner: DEMO_NOTES_CWD,
      name: 'notes/summarise.md',
      path: `${DEMO_NOTES_CWD}/.claude/commands/notes/summarise.md`,
      text: 'Summarise the notes in this folder into three bullets.\n\nKeep each bullet under a line.\n',
    },
  ],
};

/**
 * The commands the demo agent runs as prompts, as Claude runs a command file
 * or a skill: the transcript records the command, then the agent answers.
 */
export const DEMO_PROMPT_COMMANDS: ReadonlySet<string> = new Set([
  'review',
  'release-notes',
  'notes:summarise',
  'demo-tools:lint',
]);

/** What `head -c … | sed -n '1,/^---$/p'` keeps of a file: through its frontmatter's end. */
function excerptOf(text: string): string {
  const lines = text.split('\n');
  const close = lines.findIndex((line, index) => index > 0 && /^---\s*$/.test(line));
  return (close === -1 ? lines : lines.slice(0, close + 1)).join('\n');
}

function record(file: DemoCommandFile): string {
  return [
    [SLASH_FILE, file.kind, file.source, file.owner, file.name, file.path].join('\t'),
    excerptOf(file.text),
    '',
    SLASH_FILE_END,
  ].join('\n');
}

/**
 * The demo's answer to a discovery script, or null when `script` is not one.
 * Reads which parts were asked for off the calls at the script's end, as the
 * real host runs them.
 */
export function demoSlashScan(script: string): string | null {
  if (!script.includes(`echo ${SLASH_BEGIN}`)) return null;
  const out: string[] = [SLASH_BEGIN];
  const builtins = /^\s*hs_builtins '(.*)' \d+$/m.exec(script);
  if (builtins !== null) {
    out.push([SLASH_BINARY, DEMO_CLAUDE_BINARY, DEMO_CLAUDE_BINARY_STAT].join('\t'));
    if (builtins[1] === `${DEMO_CLAUDE_BINARY} ${DEMO_CLAUDE_BINARY_STAT}`) {
      out.push(SLASH_BUILTINS_UNCHANGED);
    } else {
      out.push(SLASH_BUILTINS, ...DEMO_BUILTIN_LITERALS, SLASH_BUILTINS_END);
    }
  }
  if (/^\s*hs_user$/m.test(script)) out.push(...USER_FILES.map(record));
  if (/^\s*hs_plugins$/m.test(script)) {
    out.push([SLASH_PLUGIN, 'demo-tools', DEMO_PLUGIN_PATH].join('\t'), ...PLUGIN_FILES.map(record));
  }
  for (const [, cwd] of script.matchAll(/^\s*hs_project '(.*)'$/gm)) {
    out.push(...(PROJECT_FILES[cwd!] ?? []).map(record));
  }
  out.push('', SLASH_END, '');
  return out.join('\n');
}
