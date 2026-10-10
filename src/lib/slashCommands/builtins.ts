/**
 * The commands an agent has built in, for when they cannot be read off the
 * host.
 *
 * Claude's are read from the installed binary (`discover.ts`), so this list
 * only stands in when that read finds nothing: no `claude` on PATH as a file,
 * or a bundle whose literals no longer look the way the grep expects. Its
 * names are the ones Claude Code 2.1.296 lists, in the order a read gives
 * them. The descriptions and argument hints are HerdrChat's own short
 * wording, not the terminal's: a read of the binary replaces them with the
 * terminal's own, except a description the bundle only computes at run time,
 * which keeps this one. A test compares the names with a read where that
 * version is installed and `HERDRCHAT_REAL_CLAUDE=1`; no part of the bundle is
 * checked in.
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

/** Claude Code 2.1.296's built-ins and bundled skills, by name, each with a line of HerdrChat's own. */
export const CLAUDE_BUILTINS: readonly CatalogueCommand[] = [
  c("add-dir", "Let the agent work in one more folder", "<path>"),
  c("advisor", "Have a stronger model weigh in now and then"),
  c("artifacts", "See the artifacts you have made or been sent"),
  c("auto-mode-setup", "Tell auto mode what this machine is like", "[options]"),
  c("autocompact", "Choose when the context gets summarised on its own", "[auto|<tokens>]"),
  c("autofix-pr", "Watch this branch's PR and fix what fails on it"),
  c("background", "Keep this session going without the terminal", "[prompt]"),
  c("branch", "Split the conversation here into a second one", "[name]"),
  c("brief", "Turn short answers on or off"),
  c("btw", "Ask something on the side, without derailing the work", "[question]"),
  c("bug", "Tell Anthropic about a problem", "[report]"),
  c("cd", "Move the session to another folder", "<path>"),
  c("chrome", "Settings for the Chrome extension"),
  c("clear", "Begin again with an empty context; the old session can be resumed", "[name]"),
  c("cloud-plugins", "Decide whether cloud sessions get this machine's plugins"),
  c("color", "Pick a colour for this session's prompt"),
  c("compact", "Summarise the conversation to make room in the context", "<optional instructions for the summary>"),
  c("config", "Change settings", "[key=value]"),
  c("context", "Show how full the context is", "[all]"),
  c("copy", "Copy the agent's last answer (/copy N for an earlier one)"),
  c("daemon", "Look after the background services and routines"),
  c("design-login", "Sign in so /design-sync can reach your design systems"),
  c("desktop", "Carry on in the desktop app"),
  c("diff", "See what changed, overall and turn by turn"),
  c("effort", "Choose how hard the model thinks"),
  c("exit", "Quit the agent"),
  c("export", "Save the conversation to a file or the clipboard", "[filename]"),
  c("fast", "Turn fast mode on or off", "[on|off]"),
  c("feedback", "Send Anthropic feedback or a bug report", "[report]"),
  c("focus", "Show only the prompt, the summary and the answer", "[on|off]"),
  c("fork", "Start a background agent that knows this whole conversation", "<directive>"),
  c("goal", "Give the agent a condition to meet before it stops", "[<condition>|clear]"),
  c("help", "Help, and the commands there are"),
  c("hooks", "See the hooks set up for tool events"),
  c("ide", "Connect an editor, or see what is connected", "[open]"),
  c("import", "Bring in settings from another coding agent", "[codex|gemini|cursor] [--dry-run]"),
  c("init", "Write a CLAUDE.md that describes this codebase"),
  c("insights", "A report on how your sessions have gone"),
  c("install", "Install the native build", "[options]"),
  c("install-github-app", "Set a repository up for the GitHub Actions integration"),
  c("install-slack-app", "Add the Slack app"),
  c("keybindings", "Edit your keyboard shortcuts"),
  c("list-agents", "List the agents and sessions you can message"),
  c("login", "Sign in to Anthropic"),
  c("logout", "Sign out of Anthropic"),
  c("mcp", "MCP servers: reconnect, enable or disable them", "[reconnect|enable|disable] [<server>|all]"),
  c("memory", "Edit the CLAUDE.md files and memory settings"),
  c("mobile", "A QR code for the mobile app"),
  c("model", "Choose the model", "[model]"),
  c("output-style", "See the output styles, or change to one", "[style]"),
  c("passes", "Give friends a free week"),
  c("permissions", "Which tools are allowed, and which are not"),
  c("plan", "Plan before acting, or see this session's plan", "[open|<description>]"),
  c("plugin", "Add, remove and manage plugins"),
  c("powerup", "Short interactive lessons on what the agent can do"),
  c("privacy-settings", "See and change your privacy settings"),
  c("radio", "Play lo-fi radio while it works"),
  c("rate-limit-options", "What to do about usage limits"),
  c("recap", "Sum up this session in one line"),
  c("release-notes", "What is new in this version"),
  c("reload-plugins", "Load plugin changes into this session", "[--force]"),
  c("reload-skills", "Load skills added or edited since the session began"),
  c("remote-control", "Drive this session from a phone or the web"),
  c("remote-env", "Pick the environment cloud agents start in"),
  c("rename", "Give the conversation a new name", "[name]"),
  c("restart", "Restart the agent, keeping the session"),
  c("resume", "Go back to an earlier conversation", "[id or search]"),
  c("rewind", "Take the code or the conversation back to an earlier point"),
  c("sandbox", ""),
  c("scroll-speed", "How fast the mouse wheel scrolls"),
  c("session", "The cloud session's link and QR code"),
  c("setup-bedrock", "Set up Amazon Bedrock again"),
  c("setup-vertex", "Set up Google Vertex AI again"),
  c("skill-doctor", "Find skills that take up context and are never used"),
  c("skills", "The skills there are"),
  c("status", "Version, model, account and connection status"),
  c("statusline", "Set up the status line"),
  c("stickers", "Get stickers"),
  c("stop", "End this background session, keeping its transcript and worktree"),
  c("subtask", "Hand a task to a subagent that knows everything so far", "<task>"),
  c("tasks", "What is running in the background"),
  c("team-onboarding", "Write a getting-started guide for teammates from how you work"),
  c("teleport", "Move this session to the cloud, or bring one back"),
  c("terminal-setup", "Make Shift-Enter start a new line in the terminal"),
  c("theme", "Change the colours"),
  c("tui", "Choose how the terminal UI draws", "[default|fullscreen]"),
  c("ultraplan", "Write a plan you can edit, in a cloud session", "<prompt>"),
  c("ultrareview", "A cloud agent that looks for bugs in this branch"),
  c("upgrade", "Move to a bigger plan"),
  c("usage", "Cost, plan usage and activity for this session"),
  c("usage-credits", "Set up or ask for usage credits"),
  c("voice", "Turn voice input on or off", "[hold|tap|off]"),
  c("web-setup", "Connect GitHub for cloud sessions"),
  c("workflows", "See workflows, running and done"),
  b("artifact-components", "Reusable parts for an artifact"),
  b("artifact-diagramming", "Help drawing diagrams in an artifact"),
  b("artifact-pr-review", "A pull request review as an artifact", "[pr]"),
  b("batch", "Split a big change across background agents, a PR each", "<instruction>"),
  b("claude-api", "Help with code that calls the Claude API"),
  b("claude-in-chrome", "Let the agent use pages in your Chrome"),
  b("code-review", "Look for bugs in the current changes or a PR"),
  b("commit", "Commit the current changes", "[guidance]"),
  b("dataviz", "Help with charts and dashboards"),
  b("debug", "Turn on debug logs and look into a problem", "[problem]"),
  b("design", ""),
  b("design-sync", "Push a design system's components to the design site", "[project]"),
  b("doctor", "Check the installation and setup, and fix what is wrong"),
  b("explain-usage", "Where this session's tokens went"),
  b("fewer-permission-prompts", "Allow the read-only commands you keep approving"),
  b("loop", "Run a prompt or command again and again on an interval", "[interval] [prompt]"),
  b("pr", "Open a pull request", "[guidance]"),
  b("prototype", "Build an idea into an artifact that works"),
  b("run", "Start this project's app to see a change in it"),
  b("run-skill-generator", "Make a skill that starts this project's app"),
  b("schedule", "Routines: cloud agents that run on a schedule"),
  b("security-review", "Look over this branch's changes for security problems"),
  b("setup-claude", "A guided first setup"),
  b("simplify", "Tidy the changed code, keeping what it does", "[target]"),
  b("update-config", "Change hooks, permissions and environment variables"),
  b("verify", ""),
  b("whiteboard", "Draw on a shared whiteboard and get answers on it"),
  b("workflow-authoring", "Reference for writing workflow scripts"),
  b("workshop", "Work out a design together, step by step"),
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
