package dev.herdr.herdrchat.core.commands

import dev.herdr.herdrchat.core.net.HerdrTransport
import dev.herdr.herdrchat.core.net.ShellQuoting

/**
 * Discovers the slash commands available on the host for a given working directory.
 *
 * Claude Code renders its own palette when you type `/`, but that overlay is clipped
 * to the pane's viewport and scrolls — scraping it would only ever return the handful
 * of rows that happened to fit (measured). The definitions on disk are the durable
 * source, so they are read directly: one round trip for user, project and plugin
 * commands plus skills, merged with the built-in list.
 */
class SlashCommandStore(private val transport: HerdrTransport) {

    /**
     * Built-ins plus everything defined on the host for [cwd], de-duplicated by name
     * (a project definition wins over a user one, which wins over a built-in) and
     * sorted by name.
     */
    suspend fun discover(cwd: String): List<SlashCommand> {
        val discovered = runCatching { parse(transport.shell(script(cwd))) }.getOrNull().orEmpty()
        val byName = linkedMapOf<String, SlashCommand>()
        // Insert in ascending precedence so later writes win.
        for (command in SlashCommand.builtIns) byName[command.name] = command
        for (command in discovered) byName[command.name] = command
        return byName.values.sortedBy { it.name }
    }

    fun parse(output: String): List<SlashCommand> {
        val result = mutableListOf<SlashCommand>()
        for (block in output.split("$MARKER ").drop(1)) {
            val lines = block.split("\n")
            val header = lines.firstOrNull()?.split(" ", limit = 2) ?: continue
            if (header.size != 2) continue
            val source = SlashCommand.Source.fromWire(header[0]) ?: continue
            val name = header[1].trim()
            if (name.isEmpty()) continue
            result.add(SlashCommand(name, summary(lines.getOrNull(1)), source))
        }
        return result
    }

    /** Frontmatter descriptions are often quoted and can run for paragraphs. */
    private fun summary(line: String?): String? {
        var text = line?.trim().orEmpty()
        if (text.isEmpty()) return null
        for (quote in listOf("\"", "'")) {
            if (text.startsWith(quote)) {
                text = text.removePrefix(quote).removeSuffix(quote)
                break
            }
        }
        text = text.trim()
        if (text.isEmpty()) return null
        return if (text.length > SUMMARY_LIMIT) text.take(SUMMARY_LIMIT).trim() + "…" else text
    }

    /**
     * Emits `@@HERDRCMD <source> <name>` followed by the description line, for every
     * command and skill definition in the locations Claude Code reads.
     *
     * The description is read with awk rather than a one-line sed because real
     * frontmatter uses YAML block scalars: several skills on a live host write
     * `description: >-` and put the text on the following indented lines. A
     * first-line grab returns the literal ">-" for those.
     */
    private fun script(cwd: String): String {
        val quotedCwd = ShellQuoting.quote(cwd)
        return """
        emit() {
          printf '%s %s %s\n' '$MARKER' "${'$'}1" "${'$'}2"
          awk '
            /^description:[[:space:]]*/ && !seen {
              seen = 1
              value = ${'$'}0
              sub(/^description:[[:space:]]*/, "", value)
              if (value ~ /^[>|][-+]?${'$'}/) { block = 1; next }
              print value
              exit
            }
            block {
              if (${'$'}0 ~ /^[[:space:]]+[^[:space:]]/) {
                gsub(/^[[:space:]]+/, "")
                folded = (folded == "" ? ${'$'}0 : folded " " ${'$'}0)
                next
              }
              if (folded != "") print folded
              exit
            }
            END { if (block && folded != "") print folded }
          ' "${'$'}3" 2>/dev/null
        }
        commands() {
          [ -d "${'$'}2" ] || return 0
          for f in "${'$'}2"/*.md; do
            [ -f "${'$'}f" ] || continue
            emit "${'$'}1" "${'$'}(basename "${'$'}f" .md)" "${'$'}f"
          done
        }
        skills() {
          [ -d "${'$'}2" ] || return 0
          for d in "${'$'}2"/*/; do
            [ -f "${'$'}d/SKILL.md" ] || continue
            emit "${'$'}1" "${'$'}(basename "${'$'}d")" "${'$'}d/SKILL.md"
          done
        }
        # Plugins. The plugin's NAME comes from its manifest, never from the
        # directory: on a live host the marketplace folder "addy-agent-skills"
        # provides commands namespaced "agent-skills:", so a folder-derived name
        # would list rows that do nothing when tapped. Depth isn't assumed either —
        # the cache nests as <marketplace>/<plugin>/<version>/ while a checked-out
        # marketplace doesn't — so definitions are found relative to each manifest.
        # Both command layouts are covered: plugins put .md commands under commands/
        # or under .claude/commands/ (the latter beside .toml copies for other tools).
        plugins() {
          [ -d "${'$'}1" ] || return 0
          find "${'$'}1" -maxdepth 6 -name plugin.json -type f 2>/dev/null | while IFS= read -r manifest; do
            root=${'$'}(dirname "${'$'}manifest")
            case "${'$'}(basename "${'$'}root")" in .claude-plugin) root=${'$'}(dirname "${'$'}root");; esac
            name=${'$'}(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${'$'}manifest" | head -1)
            [ -n "${'$'}name" ] || continue
            for f in "${'$'}root"/commands/*.md "${'$'}root"/.claude/commands/*.md; do
              [ -f "${'$'}f" ] || continue
              emit plugin "${'$'}name:${'$'}(basename "${'$'}f" .md)" "${'$'}f"
            done
            for d in "${'$'}root"/skills/*/; do
              [ -f "${'$'}d/SKILL.md" ] || continue
              emit plugin "${'$'}name:${'$'}(basename "${'$'}d")" "${'$'}d/SKILL.md"
            done
          done
        }
        commands userCommand "${'$'}HOME/.claude/commands"
        skills userSkill "${'$'}HOME/.claude/skills"
        commands projectCommand $quotedCwd/.claude/commands
        skills projectSkill $quotedCwd/.claude/skills
        plugins "${'$'}HOME/.claude/plugins"
        true
        """.trimIndent()
    }

    companion object {
        private const val MARKER = "@@HERDRCMD"
        /** Palette rows are one line; a whole skill description would swamp them. */
        private const val SUMMARY_LIMIT = 160
    }
}
