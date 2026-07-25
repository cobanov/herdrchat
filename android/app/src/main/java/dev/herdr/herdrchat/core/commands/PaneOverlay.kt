package dev.herdr.herdrchat.core.commands

import dev.herdr.herdrchat.core.transcript.BlockedPrompt
import dev.herdr.herdrchat.core.transcript.BlockedPromptParser

/**
 * A keyboard affordance a Claude Code overlay advertises in its footer, e.g.
 * "s to use this session only" or "Esc to cancel". Claude spells these out on
 * screen, so they are read rather than guessed.
 */
data class OverlayAction(
    /** Key label as shown ("Enter", "Esc", "s"). */
    val key: String,
    /** What it does ("set as default", "use this session only", "cancel"). */
    val detail: String,
    /** Token(s) for `pane send-keys`. */
    val keys: List<String>,
)

/**
 * What kind of interactive surface is on screen. Both shapes were observed on a
 * live pane and they need different UI: one can be answered with buttons, the
 * other can only be driven.
 */
sealed interface PaneOverlayKind {
    /** A numbered menu — `/model`, permission prompts. Answerable by tapping a row. */
    data class Menu(val prompt: BlockedPrompt) : PaneOverlayKind

    /**
     * An overlay with no numbered rows: `/resume` is a search box over a list,
     * driven by typing plus arrows. There are no rows to turn into buttons, so the
     * app shows the screen itself and a keypad instead of pretending otherwise.
     * Without this, every such command would be a dead end.
     */
    data class Raw(val screen: String, val title: String?) : PaneOverlayKind
}

/**
 * An interactive surface currently drawn over an agent pane.
 *
 * This exists because of a measured fact: when a slash command like `/model`
 * opens its picker, herdr still reports the agent as `idle`, NOT `blocked`. So the
 * blocked-status path can't see these at all — they have to be spotted on the
 * screen itself.
 */
data class PaneOverlay(
    val kind: PaneOverlayKind,
    /** Extra keys the footer offered, beyond picking a numbered option. */
    val actions: List<OverlayAction>,
) {
    val prompt: BlockedPrompt? get() = (kind as? PaneOverlayKind.Menu)?.prompt
    val isRaw: Boolean get() = kind is PaneOverlayKind.Raw
}

object PaneOverlayDetector {
    /**
     * How far up from the bottom of the screen a real overlay can start, when
     * there is no rule to bound it.
     */
    private const val OVERLAY_WINDOW = 30

    private val ANSI = Regex("\\[[0-9;?]*[A-Za-z]")
    private val BORDER_CHARS = "│┃|╭╮╰╯─━▔┌┐└┘├┤ \t".toSet()
    private val AFFORDANCE = Regex(
        "\\b(enter|esc|escape|return|tab|space|↑|↓|←|→)\\b[^·]{0,40}?\\bto\\b",
        RegexOption.IGNORE_CASE,
    )

    /**
     * The keys every driven overlay accepts whether or not its footer spells them
     * out: move the selection, confirm, cancel. `/resume` documents Ctrl chords
     * and "Type to search" but never mentions the arrows it is navigated with.
     */
    val navigationActions: List<OverlayAction> = listOf(
        OverlayAction("↑", "up", listOf("Up")),
        OverlayAction("↓", "down", listOf("Down")),
        OverlayAction("Enter", "select", listOf("Enter")),
        OverlayAction("Esc", "cancel", listOf("Escape")),
    )

    /**
     * Look for an interactive surface in a pane's VISIBLE screen.
     *
     * The gate is the FOOTER, not the menu: nothing is reported unless the screen
     * advertises keyboard affordances ("Enter to confirm · Esc to cancel"). That is
     * what keeps ordinary content out — an agent answering with a numbered list is
     * routine, but only a real overlay tells you which keys it takes. Requiring
     * that corroboration is the difference between a detector and a guess.
     *
     * With the footer present, a numbered menu becomes [PaneOverlayKind.Menu];
     * anything else becomes [PaneOverlayKind.Raw] so it can still be driven rather
     * than being a dead end.
     */
    fun detect(raw: String): PaneOverlay? {
        val lines = raw.split("\n")
        val footer = footerLine(lines) ?: return null
        val actions = actions(footer)

        val region = overlayRegion(lines)
        val prompt = BlockedPromptParser.parse(region.joinToString("\n"))
        // One "option" is far too weak a signal to treat as a menu.
        if (prompt.options.size >= 2) {
            return PaneOverlay(PaneOverlayKind.Menu(prompt), actions)
        }

        // No rows to tap: hand back the screen so the UI can show it verbatim.
        val body = region.map { strip(it) }
            .dropWhile { it.isEmpty() }
            .dropLastWhile { it.isEmpty() }
        val screen = body.joinToString("\n")
        if (screen.isEmpty()) return null
        return PaneOverlay(
            PaneOverlayKind.Raw(screen, body.firstOrNull { it.isNotEmpty() }),
            actions,
        )
    }

    /**
     * The overlay's own region of the screen. Claude draws a `▔▔▔` rule directly
     * above an overlay — observed on both `/model` and `/resume` — so that rule
     * bounds it exactly. Falling back to a fixed number of trailing lines would
     * otherwise drag conversation text into the card.
     */
    private fun overlayRegion(lines: List<String>): List<String> {
        val index = lines.indexOfLast { isTopRule(it) }
        return if (index >= 0) lines.drop(index + 1) else lines.takeLast(OVERLAY_WINDOW)
    }

    private fun isTopRule(line: String): Boolean {
        val trimmed = line.trim()
        return trimmed.length >= 8 && trimmed.all { it == '▔' }
    }

    /**
     * The last line that reads like a hint footer. Claude draws it under the menu,
     * above the input box.
     */
    private fun footerLine(lines: List<String>): String? =
        lines.takeLast(OVERLAY_WINDOW)
            .asReversed()
            .map { strip(it) }
            .firstOrNull { it.isNotEmpty() && isAffordanceFooter(it) }

    fun isAffordanceFooter(line: String): Boolean = AFFORDANCE.containsMatchIn(line)

    /**
     * Split a footer into its individual affordances. Segments are separated by "·"
     * and each reads "<key> to <what it does>".
     */
    fun actions(footer: String): List<OverlayAction> =
        footer.split("·").mapNotNull { action(it.trim()) }

    private fun action(segment: String): OverlayAction? {
        val index = segment.indexOf(" to ", ignoreCase = true)
        if (index <= 0) return null
        val key = segment.substring(0, index).trim()
        val detail = segment.substring(index + 4).trim()
        if (key.isEmpty() || detail.isEmpty()) return null
        val keys = sendKeys(key) ?: return null
        return OverlayAction(key, detail, keys)
    }

    /**
     * Map a footer's key label onto `pane send-keys` tokens. Returns null for
     * anything we can't send faithfully — "↑/↓", "Type to search" — so the UI never
     * offers a button that would do nothing.
     */
    fun sendKeys(label: String): List<String>? {
        val lower = label.lowercase()
        when (lower) {
            "enter", "return" -> return listOf("Enter")
            "esc", "escape" -> return listOf("Escape")
            "tab" -> return listOf("Tab")
            "space" -> return listOf("Space")
        }
        // Control chords, which `/resume` advertises as "Ctrl+A to show all
        // projects". herdr wants `ctrl+<letter>`; it rejects the tmux-style `C-a`
        // outright with `unsupported key` — verified against a live pane, which is
        // the only reason this isn't shipped as a button that errors on tap.
        for (prefix in listOf("ctrl+", "ctrl-", "^")) {
            if (lower.startsWith(prefix)) {
                val rest = lower.removePrefix(prefix)
                val character = rest.singleOrNull() ?: return null
                return if (character.isLetter()) listOf("ctrl+$character") else null
            }
        }
        // A bare letter shortcut, e.g. "s to use this session only".
        val character = label.singleOrNull() ?: return null
        return if (character.isLetter()) listOf(character.toString()) else null
    }

    /** Strip ANSI escapes and TUI border chrome from one line. */
    private fun strip(line: String): String =
        ANSI.replace(line, "").trim { it in BORDER_CHARS }
}
