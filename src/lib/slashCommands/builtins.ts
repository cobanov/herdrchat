/**
 * The commands an agent has built in, for when they cannot be read off the
 * host.
 *
 * Claude's are read from the installed binary (`discover.ts`), so this list
 * only stands in when that read finds nothing: no `claude` on PATH as a file,
 * or a bundle whose literals no longer look the way the grep expects. It is
 * what the read gives on Claude Code 2.1.296 (the fixture
 * `__tests__/fixtures/slashCommands/claude-2.1.296-literals.txt`, run through
 * `parseBuiltins`; a test keeps the two equal), with the two descriptions the
 * bundle only computes filled in by hand from the functions that compute them:
 * `/exit` and `/ultrareview`.
 *
 * Codex's commands are not read at all: its binary is Rust, and its strings
 * run together with no marker between a name and its description. Its list is
 * the Codex 0.157 TUI's `/` menu, each description verified verbatim against
 * `strings` on the binary and each name against the binary's own mentions of
 * it (its tips, "Use /name to …", its `Usage: /name …` lines, its table of names). Commands
 * whose name could not be confirmed that way are left out (see the list's
 * comment). Codex skills are mentioned with `$`, not `/`, so none are here.
 */
import type { CatalogueCommand } from './types';

function c(name: string, description: string, argumentHint: string | null = null): CatalogueCommand {
  return { name, description, argumentHint, section: 'builtin', source: 'builtin' };
}

function b(name: string, description: string, argumentHint: string | null = null): CatalogueCommand {
  return { name, description, argumentHint, section: 'skills', source: 'bundled' };
}

/** Claude Code 2.1.296's built-ins and bundled skills, as the terminal lists them. */
export const CLAUDE_BUILTINS: readonly CatalogueCommand[] = [
  c("add-dir", "Add a new working directory", "<path>"),
  c("advisor", "Let Claude consult a stronger model at key moments"),
  c("artifacts", "Browse your published and shared artifacts"),
  c("auto-mode-setup", "Teach auto mode about your environment, plus optional rule tweaks", "[--request-id <uuid>] (--wizard posture=… scope=… depth=… --propose | --expect-sha256 <64-hex> --apply-file <path>)"),
  c("autocompact", "Set how full the context gets before auto-summarizing", "[auto|<tokens>]"),
  c("autofix-pr", "Monitor and autofix any issues with the current PR"),
  c("background", "Send this session to the background and free the terminal", "[prompt]"),
  c("branch", "Create a branch of the current conversation at this point", "[name]"),
  c("brief", "Toggle brief-only mode"),
  c("btw", "Ask a quick side question without interrupting the main conversation", "[question]"),
  c("bug", "Report a bug or share your conversation", "[report]"),
  c("cd", "Move this session to a new working directory", "<path>"),
  c("chrome", "Open Claude in Chrome settings"),
  c("clear", "Start a new session with empty context; previous session stays on disk (resumable with /resume)", "[name]"),
  c("cloud-plugins", "Choose whether cloud sessions use the plugins enabled on this machine"),
  c("color", "Set the prompt bar color for this session"),
  c("compact", "Free up context by summarizing the conversation so far", "<optional custom summarization instructions>"),
  c("config", "Open settings", "[key=value]"),
  c("context", "Visualize current context usage as a colored grid", "[all]"),
  c("copy", "Copy Claude's last response to clipboard (or /copy N for the Nth-latest)"),
  c("daemon", "Manage background services and routines"),
  c("design-login", "Authorize design-system access for /design-sync with your claude.ai account"),
  c("desktop", "Continue the current session in Claude Desktop"),
  c("diff", "View uncommitted changes and per-turn diffs"),
  c("effort", "Set effort level for model usage"),
  c("exit", "Exit the CLI"),
  c("export", "Export the current conversation to a file or clipboard", "[filename]"),
  c("fast", "Toggle fast mode", "[on|off]"),
  c("feedback", "Send feedback to Anthropic or report a bug", "[report]"),
  c("focus", "Toggle focus view: just your prompt, summary, and response", "[on|off]"),
  c("fork", "Spawn a background agent that inherits the full conversation", "<directive>"),
  c("goal", "Set a goal Claude checks before stopping", "[<condition> | clear]"),
  c("help", "Show help and available commands"),
  c("hooks", "View hook configurations for tool events"),
  c("ide", "Manage IDE integrations and show status", "[open]"),
  c("import", "Import config from another AI coding agent", "[codex|gemini|cursor] [--dry-run]"),
  c("init", "Initialize a new CLAUDE.md file with codebase documentation"),
  c("insights", "Generate a report analyzing your Claude Code sessions"),
  c("install", "Install Claude Code native build", "[options]"),
  c("install-github-app", "Set up Claude GitHub Actions for a repository"),
  c("install-slack-app", "Install the Claude Slack app"),
  c("keybindings", "Open your keyboard shortcuts file"),
  c("list-agents", "List subagents, teammates, and other Claude sessions you can message"),
  c("login", "Sign in with your Anthropic account"),
  c("logout", "Sign out from your Anthropic account"),
  c("mcp", "Manage MCP servers", "[reconnect (<server>|all)|enable|disable [<server>|all]]"),
  c("memory", "Edit CLAUDE.md files and memory settings"),
  c("mobile", "Show QR code to download the Claude mobile app"),
  c("model", "Set the AI model for Claude Code", "[model]"),
  c("output-style", "List output styles or switch to one", "[style]"),
  c("passes", "Share a free week of Claude Code with friends"),
  c("permissions", "Manage allow and deny tool permission rules"),
  c("plan", "Enable plan mode or view the current session plan", "[open|<description>]"),
  c("plugin", "Manage Claude Code plugins"),
  c("powerup", "Discover Claude Code features through quick interactive lessons"),
  c("privacy-settings", "View and update your privacy settings"),
  c("radio", "Listen to Claude FM lo-fi radio"),
  c("rate-limit-options", "Manage usage limits and upgrade options"),
  c("recap", "Generate a one-line session recap now"),
  c("release-notes", "View release notes"),
  c("reload-plugins", "Activate pending plugin changes in the current session", "[--force]"),
  c("reload-skills", "Pick up skills added or changed on disk during this session"),
  c("remote-control", "Control this session from your phone or claude.ai/code"),
  c("remote-env", "Choose the default environment for cloud agents"),
  c("rename", "Rename the current conversation", "[name]"),
  c("restart", "Restart Claude Code and keep this session"),
  c("resume", "Resume a previous conversation", "[conversation id or search term]"),
  c("rewind", "Restore the code and/or conversation to a previous point"),
  c("sandbox", ""),
  c("scroll-speed", "Adjust mouse wheel scroll speed"),
  c("session", "Show cloud session URL and QR code"),
  c("setup-bedrock", "Reconfigure Amazon Bedrock authentication, region, or model pins"),
  c("setup-vertex", "Reconfigure Google Vertex AI authentication, project, region, or model pins"),
  c("skill-doctor", "Show which loaded skills are unused and costing context"),
  c("skills", "List available skills"),
  c("status", "Show Claude Code status including version, model, account, API connectivity, and tool statuses"),
  c("statusline", "Set up Claude Code's status line UI"),
  c("stickers", "Order Claude Code stickers"),
  c("stop", "Stop this background session; transcript and worktree are kept"),
  c("subtask", "Send a subagent off with your full context; its result comes back here", "<task>"),
  c("tasks", "View and manage everything running in the background"),
  c("team-onboarding", "Help teammates ramp on Claude Code with a guide from your usage"),
  c("teleport", "Send this session to the cloud, or resume one from claude.ai"),
  c("terminal-setup", "Install Shift+Enter key binding for newlines"),
  c("theme", "Change the theme"),
  c("tui", "Set the terminal UI renderer (default | fullscreen)", "[default|fullscreen]"),
  c("ultraplan", "Draft an editable plan in a cloud session", "<prompt>"),
  c("ultrareview", "Start a cloud agent that finds and verifies bugs in your branch"),
  c("upgrade", "Upgrade to Max for higher rate limits and more Opus"),
  c("usage", "Show session cost, plan usage, and activity stats"),
  c("usage-credits", "Configure usage credits or request them from your admin when you hit a limit"),
  c("voice", "Toggle voice mode", "[hold|tap|off]"),
  c("web-setup", "Set up cloud sessions with your GitHub account"),
  c("workflows", "Browse running and completed workflows"),
  b("artifact-components", "Embed reusable components in an Artifact"),
  b("artifact-diagramming", "Diagramming guidance for Artifacts"),
  b("artifact-pr-review", "Publish a PR review briefing Artifact from a template", "[pr number or url]"),
  b("batch", "Plan a large change; background agents each open a PR", "<instruction>"),
  b("claude-api", "Build and debug apps that use the Claude API"),
  b("claude-in-chrome", "Let Claude browse and interact with pages in your Chrome"),
  b("code-review", "Review the current diff or a PR for bugs and cleanups"),
  b("commit", "Create a git commit", "[guidance]"),
  b("dataviz", "Chart and dashboard design guidance"),
  b("debug", "Turn on debug logging and investigate problems", "[issue description]"),
  b("design", ""),
  b("design-sync", "Push your design system components to claude.ai/design", "[<project hint, e.g. \"Acme DS\">]"),
  b("doctor", "Health-check your setup and fix issues: installation, unused extensions, duplicated or bloated memory files, slow hooks, updates, permissions"),
  b("explain-usage", "See where this session’s tokens went, in plain words"),
  b("fewer-permission-prompts", "Pre-approve safe read-only commands based on your usage"),
  b("loop", "Repeat a prompt or command on an interval (e.g. /loop 5m /foo)", "[interval] [prompt]"),
  b("pr", "Create a pull request", "[guidance]"),
  b("prototype", "Prototype an idea as a working Artifact"),
  b("run", "Launch this project’s app to see your change working"),
  b("run-skill-generator", "Create a skill that knows how to run this project’s app"),
  b("schedule", "Create and manage routines: cloud agents on a schedule"),
  b("security-review", "Complete a security review of the pending changes on the current branch"),
  b("setup-claude", "Guided setup — pick a role, install a plugin, try a skill, connect tools"),
  b("simplify", "Clean up the changed code without changing behavior", "[<target>]"),
  b("update-config", "Change settings: hooks, permissions, environment variables"),
  b("verify", ""),
  b("whiteboard", "Pair on a whiteboard artifact — you draw, Claude answers on it"),
  b("workflow-authoring", "Load the reference for writing Workflow tool scripts"),
  b("workshop", "Build a design together, one decision at a time"),
];

/**
 * Descriptions the bundle computes at run time, which no literal states. The
 * read of the binary falls back to these, by name.
 */
export const CLAUDE_BUILTIN_DESCRIPTIONS: ReadonlyMap<string, string> = new Map(
  CLAUDE_BUILTINS.filter((command) => command.description.length > 0).map((command) => [command.name, command.description])
);

/**
 * Codex 0.157.1's `/` menu. Left out, unconfirmed: the descriptions "approve
 * one retry of a recent auto-review denial", "configure memory use and
 * generation", "switch to Plan mode", "mention a file", "choose the TUI mode
 * for the next launch", "view retained warnings and diagnostic details",
 * "configure which items appear in the terminal title" and "browse plugins",
 * whose names the binary never spells out; `/fast`, whose menu description is
 * not in it; and the debug-only `/rollout` and `/test-approval`, and
 * `/setup-default-sandbox` (Windows).
 */
export const CODEX_BUILTINS: readonly CatalogueCommand[] = [
  c('model', 'choose what model and reasoning effort to use'),
  c('ide', 'include current selection, open files, and other context from your IDE', '[on|off|status]'),
  c('permissions', 'choose what Codex is allowed to do'),
  c('keymap', 'remap TUI shortcuts', '[debug]'),
  c('vim', 'toggle Vim mode for the composer'),
  c('experimental', 'toggle experimental features'),
  c('skills', 'use skills to improve how Codex performs specific tasks'),
  c('import', 'import setup, this project, and recent chats from Claude Code'),
  c('hooks', 'view and manage lifecycle hooks'),
  c('review', 'review my current changes and find issues'),
  c('rename', 'rename the current thread'),
  c('new', 'start a new chat during a conversation'),
  c('archive', 'archive this session'),
  c('delete', 'permanently delete this session'),
  c('resume', 'resume a saved chat'),
  c('fork', 'fork the current chat'),
  c('worktree', 'start or continue a conversation in a new worktree'),
  c('app', 'continue this session in the Desktop app'),
  c('init', 'create an AGENTS.md file with instructions for Codex'),
  c('compact', 'summarize conversation to prevent hitting the context limit'),
  c('recap', 'summarize the current conversation now'),
  c('voice', 'start or stop voice; use /voice settings to choose a voice', '[settings|mute|stop]'),
  c('goal', 'set or view the goal for a long-running task', '[<objective>|clear|edit|pause|resume]'),
  c('agents', 'open the agent command center'),
  c('side', 'start a side conversation in an ephemeral fork'),
  c('copy', 'copy the last response or part of it'),
  c('export', 'export the conversation as markdown'),
  c('raw', 'toggle raw scrollback mode for copy-friendly terminal selection', '[on|off]'),
  c('diff', 'show git diff (including untracked files)'),
  c('status', 'show current session configuration and token usage'),
  c('daemon', 'Manage the local background server'),
  c('cd', 'change the current working directory'),
  c('pwd', 'show the current working directory'),
  c('usage', 'view account usage or use a usage limit reset', '[daily|weekly|cumulative]'),
  c('debug-config', 'show config layers and requirement sources for debugging'),
  c('statusline', 'configure which items appear in the status line'),
  c('theme', 'choose a syntax highlighting theme'),
  c('pets', 'choose or hide the terminal pet'),
  c('mcp', 'list configured MCP tools; use /mcp verbose for details', '[verbose]'),
  c('apps', 'manage apps'),
  c('logout', 'log out of Codex'),
  c('quit', 'exit Codex'),
  c('feedback', 'send logs to maintainers'),
  c('ps', 'list background terminals'),
  c('stop', 'stop all background terminals'),
  c('clear', 'clear the terminal and start a new chat'),
  c('subagents', "switch between this session's subagents"),
];
