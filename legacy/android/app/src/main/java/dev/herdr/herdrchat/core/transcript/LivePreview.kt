package dev.herdr.herdrchat.core.transcript

/** Best-effort extraction of an agent's in-progress answer from the pane's
 *  VISIBLE screen, for a live "streaming" preview bubble while the turn is still
 *  being written. Spinner-anchor heuristic (à la cmux): find the status line,
 *  take the prose block above it, drop TUI chrome. Returns null unless it finds
 *  real prose, so the caller can fall back to a plain waiting bar. */
object LivePreviewExtractor {
    // ESC + CSI ( is interpreted by the Java regex engine; printable in source).
    private val ansi = Regex("\\u001B\\[[0-9;?]*[A-Za-z]")
    private const val BORDER = "│┃|╭╮╰╯─┌┐└┘├┤ \t"

    fun extract(raw: String): String? {
        val lines = raw.split("\n").map { clean(it) }
        val anchor = lines.indexOfLast { isStatusLine(it) }.takeIf { it >= 0 }
        val end = anchor ?: lines.indexOfLast { it.startsWith("❯") }.takeIf { it >= 0 } ?: lines.size
        val collected = ArrayDeque<String>()
        var i = end - 1
        while (i >= 0 && collected.size < 8) {
            val line = lines[i]
            if (line.isEmpty()) { if (collected.isEmpty()) { i--; continue } else break }
            if (isChrome(line)) { i--; continue }
            collected.addFirst(line); i--
        }
        var text = collected.joinToString("\n").trim()
        for (b in listOf("⏺", "●", "⏵")) if (text.startsWith(b)) { text = text.removePrefix(b).trim(); break }
        return if (text.length >= 20) text else null
    }

    private fun clean(line: String) = ansi.replace(line, "").trim { it in BORDER }

    private fun isStatusLine(s: String): Boolean {
        if (s.isEmpty()) return false
        if (s.any { it in "✳✽✻✢✶✷✸✹✺⚹∗·" }) return true
        val l = s.lowercase()
        return l.contains("esc to interrupt") || l.contains("tokens)") || (l.contains("token") && l.contains("↓ "))
    }

    private fun isChrome(s: String): Boolean {
        if (s.startsWith("❯") || s.startsWith(">")) return true
        if (s.isNotEmpty() && s.all { it == '-' || it == '─' || it == '=' }) return true
        val l = s.lowercase()
        return l.contains("manual mode") || l.contains("for agents") || l.contains("/effort") ||
            l.contains("◉") || l.contains("esc to") || l.contains("ctrl+") || l.contains("⏸") ||
            l.contains("resume this session") || l.contains("? for shortcuts") ||
            (s.contains("|") && s.contains("@") && (s.contains("~") || s.contains("/")))
    }
}
