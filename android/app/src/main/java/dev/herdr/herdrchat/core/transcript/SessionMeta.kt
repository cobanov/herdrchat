package dev.herdr.herdrchat.core.transcript

/** Lightweight session facts for the chat header: which Claude model is answering
 *  and how full the context window is, sourced from the newest assistant turn. */
data class SessionMeta(val model: String?, val contextTokens: Int?) {

    /** Friendly model name: "claude-opus-4-8" → "Opus 4.8", "claude-fable-5" →
     *  "Fable 5". Falls back to the raw id if it doesn't fit the pattern. */
    val modelDisplayName: String?
        get() {
            val m = model ?: return null
            val noPrefix = m.substringBefore("[").removePrefix("claude-")
            val tokens = noPrefix.split("-")
            val family = tokens.firstOrNull()?.takeIf { it.isNotEmpty() } ?: return m
            val familyName = family.replaceFirstChar { it.uppercase() }
            val version = tokens.drop(1)
                .filter { it.isNotEmpty() && it.all(Char::isDigit) && it.length <= 2 }
                .joinToString(".")
            return if (version.isEmpty()) familyName else "$familyName $version"
        }

    /** Compact context label, e.g. "ctx 33k". A token COUNT, not a percentage —
     *  the window size (200K vs a 1M variant) isn't in the transcript. */
    val contextLabel: String?
        get() {
            val t = contextTokens ?: return null
            return if (t >= 1000) "ctx ${(t + 500) / 1000}k" else "ctx $t"
        }
}
