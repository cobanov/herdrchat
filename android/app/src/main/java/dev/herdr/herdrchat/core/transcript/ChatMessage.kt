package dev.herdr.herdrchat.core.transcript

/** A single WhatsApp-style bubble derived from a Claude Code transcript turn.
 *  One transcript entry maps to one ChatMessage; the turn's parts become ordered
 *  [segments] so the UI can show text while collapsing thinking and tool activity. */
data class ChatMessage(
    val id: String,
    val role: Role,
    val segments: List<MessageSegment>,
    val timestamp: Long?,          // epoch millis, or null
    /** Which agent produced this (e.g. "claude"); set when a workspace thread
     *  merges more than one agent so bubbles can be labelled. */
    val agentLabel: String? = null,
    /** Sidechain = subagent chatter. Kept but flagged so the UI can hide it. */
    val isSidechain: Boolean = false,
) {
    enum class Role { USER, ASSISTANT, SYSTEM }

    /** The plain text a bubble shows (text segments joined). Empty when the turn
     *  was pure thinking/tool activity. */
    val displayText: String
        get() = segments.filterIsInstance<MessageSegment.Text>().joinToString("\n") { it.value }

    /** True when the turn carried no user-visible text (only thinking/tools). */
    val isToolOnly: Boolean get() = displayText.isBlank()
}

sealed interface MessageSegment {
    data class Text(val value: String) : MessageSegment
    data class Thinking(val value: String) : MessageSegment
    data class ToolUse(val name: String, val input: String?) : MessageSegment
    data class ToolResult(val value: String) : MessageSegment
}
