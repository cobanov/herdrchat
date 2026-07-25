package dev.herdr.herdrchat.core.commands

/**
 * A slash command that can be invoked in an agent pane, as shown in the command
 * palette.
 *
 * The palette is a DISCOVERY aid, not the boundary of what you can run: the
 * composer always accepts free text, so any command — including one this list
 * doesn't know about — can still be typed and sent by hand. That is why an
 * incomplete built-in list is a cosmetic gap rather than a functional limit.
 */
data class SlashCommand(
    /** Command name without the leading slash. */
    val name: String,
    /** One-line description, when the source provides one. */
    val summary: String?,
    val source: Source,
) {
    // Single-line comments on purpose: the paths below contain "*/", which would
    // close a KDoc block early.
    enum class Source(val badge: String) {
        // Shipped by Claude Code itself.
        BUILT_IN("built-in"),
        // ~/.claude/commands/*.md
        USER_COMMAND("user"),
        // <cwd>/.claude/commands/*.md
        PROJECT_COMMAND("project"),
        // ~/.claude/skills/*/SKILL.md
        USER_SKILL("skill"),
        // <cwd>/.claude/skills/*/SKILL.md
        PROJECT_SKILL("project skill"),
        // Provided by an installed plugin, namespaced <plugin>:<name>.
        PLUGIN("plugin"),
        ;

        companion object {
            /** Wire name used by the discovery script, matching iOS. */
            fun fromWire(raw: String): Source? = when (raw) {
                "builtIn" -> BUILT_IN
                "userCommand" -> USER_COMMAND
                "projectCommand" -> PROJECT_COMMAND
                "userSkill" -> USER_SKILL
                "projectSkill" -> PROJECT_SKILL
                "plugin" -> PLUGIN
                else -> null
            }
        }
    }

    val id: String get() = "${source.name}:$name"

    /** What gets typed into the pane. */
    val invocation: String get() = "/$name"

    /** Does this command match what the user typed after the slash? */
    fun matches(query: String): Boolean =
        query.isEmpty() || name.lowercase().contains(query.lowercase())

    /** Lower sorts first: exact, then prefix, then interior match. */
    fun rank(query: String): Int {
        if (query.isEmpty()) return 1
        val name = this.name.lowercase()
        val q = query.lowercase()
        return when {
            name == q -> 0
            name.startsWith(q) -> 1
            else -> 2
        }
    }

    companion object {
        /**
         * Claude Code's own commands, curated. Deliberately conservative — the
         * long-stable ones worth one-tap access, not every command in every
         * version. An unknown command is a soft failure (Claude Code answers
         * "unknown command" in the pane) and anything missing can still be typed,
         * so being incomplete costs discoverability, not capability.
         *
         * No /agents: its wizard was removed in Claude Code 2.1 and the command
         * now only prints a note pointing at the docs. Verified on a live pane.
         */
        val builtIns: List<SlashCommand> = listOf(
            "model" to "Switch between Claude models",
            "effort" to "Set reasoning effort for this session",
            "clear" to "Start a fresh conversation — clears history",
            "compact" to "Summarise the conversation to free up context",
            "context" to "Show what is currently filling the context window",
            "cost" to "Show token usage and cost for this session",
            "usage" to "Show plan usage and limits",
            "resume" to "Reopen an earlier conversation",
            "rewind" to "Roll the conversation back to an earlier point",
            "todos" to "Show the current task list",
            "memory" to "Edit CLAUDE.md memory files",
            "init" to "Create a CLAUDE.md for this project",
            "review" to "Review a pull request",
            "permissions" to "View and edit tool permissions",
            "hooks" to "Configure hooks",
            "mcp" to "Manage MCP servers",
            "config" to "Open settings",
            "status" to "Show version, account and connection status",
            "doctor" to "Diagnose the installation",
            "export" to "Export this conversation",
            "add-dir" to "Give Claude access to another directory",
            "output-style" to "Change the output style",
            "statusline" to "Configure the status line",
            "release-notes" to "What changed in recent versions",
            "help" to "List available commands",
            "bug" to "Report a bug to Anthropic",
        ).map { (name, summary) -> SlashCommand(name, summary, Source.BUILT_IN) }
    }
}
