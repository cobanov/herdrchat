package dev.herdr.herdrchat.core.transcript

/** One selectable choice from a blocked agent prompt: the keys to send and the
 *  human-readable label to show on the button. */
data class BlockedOption(val number: Int, val label: String) {
    /** Keys to submit this choice: press the number, then Enter. */
    val keys: List<String> get() = listOf(number.toString(), "Enter")
}

/** A parsed "agent is waiting for input" prompt: the question plus its numbered
 *  options, extracted from the pane's terminal buffer so the quick-reply bar can
 *  show what each choice actually does instead of bare "1 / 2" chips. */
data class BlockedPrompt(val question: String?, val options: List<BlockedOption>) {
    val isEmpty: Boolean get() = options.isEmpty()
}

object BlockedPromptParser {
    // ANSI CSI escape (colours, cursor moves): ESC [ ... letter.
    private val ansi = Regex("\\[[0-9;?]*[A-Za-z]")
    private val hint = Regex("\\s*\\((esc|enter|return)\\)\\s*$", RegexOption.IGNORE_CASE)
    private const val BORDER = "│┃|╭╮╰╯─┌┐└┘├┤ \t"

    /** Parse the tail of an agent pane into a question + numbered options. Returns
     *  a prompt with no options when the buffer holds no recognizable menu (the UI
     *  then falls back to its generic chips). */
    fun parse(raw: String): BlockedPrompt {
        val cleaned = raw.split("\n").map { clean(it) }

        val options = mutableListOf<BlockedOption>()
        var firstOptionLine: Int? = null
        for ((index, line) in cleaned.withIndex()) {
            val opt = option(line) ?: continue
            // A later menu supersedes an earlier one still in scrollback.
            val last = options.lastOrNull()
            if (last != null && opt.number <= last.number) {
                options.clear()
                firstOptionLine = index
            }
            if (firstOptionLine == null) firstOptionLine = index
            options.add(opt)
        }

        val firstLine = firstOptionLine
        if (options.isEmpty() || firstLine == null) return BlockedPrompt(null, emptyList())

        // Question: contiguous non-empty text lines directly above the first option.
        val questionLines = mutableListOf<String>()
        var i = firstLine - 1
        while (i >= 0 && cleaned[i].isEmpty()) i--
        while (i >= 0 && cleaned[i].isNotEmpty() && option(cleaned[i]) == null) {
            questionLines.add(0, cleaned[i]); i--
        }
        val question = questionLines.joinToString(" ").trim()
        return BlockedPrompt(question.ifEmpty { null }, options)
    }

    /** Strip ANSI escapes and TUI box/border chrome, then trim. */
    private fun clean(line: String): String =
        ansi.replace(line, "").trim { it in BORDER }

    /** Parse a single cleaned line as a menu option, e.g. "❯ 2. Yes, allow all". */
    private fun option(line: String): BlockedOption? {
        var s = line
        for (marker in listOf("❯", "▶", ">", "→", "•", "*")) {
            if (s.startsWith(marker)) { s = s.removePrefix(marker).trim(); break }
        }
        val digits = s.takeWhile { it.isDigit() }
        if (digits.isEmpty()) return null
        val number = digits.toIntOrNull() ?: return null
        val after = s.drop(digits.length)
        val punct = after.firstOrNull() ?: return null
        if (punct != '.' && punct != ')') return null
        var label = after.drop(1).trim()
        if (label.isEmpty()) return null
        label = hint.replace(label, "").trim()
        if (label.isEmpty()) return null
        return BlockedOption(number, label)
    }
}
