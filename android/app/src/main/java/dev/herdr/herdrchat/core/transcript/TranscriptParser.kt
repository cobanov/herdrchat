package dev.herdr.herdrchat.core.transcript

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import java.time.Instant
import java.time.OffsetDateTime
import java.util.UUID

/**
 * Turns Claude Code transcript JSONL (one JSON object per line) into chat bubbles.
 * Claude writes every turn to `~/.claude/projects/<escaped-cwd>/<sessionId>.jsonl`.
 *
 * Note the mixed casing: the outer entry is camelCase (`isSidechain`, `uuid`) while
 * the Anthropic message blocks are snake_case (`tool_use_id`). We read the exact
 * keys we need, all of which are unambiguous here.
 */
object TranscriptParser {

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    /** Parse a whole transcript file's contents. */
    fun parse(contents: String, agentLabel: String? = null): List<ChatMessage> =
        contents.split("\n").mapNotNull { line ->
            if (line.isBlank()) null else message(line, agentLabel)
        }

    /** Parse a single JSONL line. Returns null for non-conversational entries and
     *  for turns that carry no segments. */
    fun message(line: String, agentLabel: String? = null): ChatMessage? {
        val obj = try {
            json.parseToJsonElement(line).jsonObject
        } catch (e: Exception) {
            return null
        }

        val role = when (obj.str("type")) {
            "user" -> ChatMessage.Role.USER
            "assistant" -> ChatMessage.Role.ASSISTANT
            else -> return null   // system/mode/attachment/etc. are not bubbles
        }

        val content = (obj["message"] as? JsonObject)?.get("content")
        val segments = segmentsFrom(content)
        if (segments.isEmpty()) return null

        return ChatMessage(
            id = obj.str("uuid") ?: UUID.randomUUID().toString(),
            role = role,
            segments = segments,
            timestamp = obj.str("timestamp")?.let(::parseTimestamp),
            agentLabel = agentLabel,
            isSidechain = (obj["isSidechain"] as? JsonPrimitive)?.booleanOrNull ?: false,
        )
    }

    /** Claude escapes a cwd into a project dir name by replacing `/` and `.` with
     *  hyphens, e.g. `/Users/x/Dev/app` -> `-Users-x-Dev-app`. */
    fun projectDirName(cwd: String): String =
        buildString { cwd.forEach { append(if (it == '/' || it == '.') '-' else it) } }

    // MARK: - Internals

    private fun segmentsFrom(content: JsonElement?): List<MessageSegment> = when (content) {
        null, is JsonNull -> emptyList()
        is JsonPrimitive -> {
            val s = content.contentOrNull.orEmpty()
            if (s.isBlank()) emptyList() else listOf(MessageSegment.Text(s))
        }
        is JsonArray -> content.mapNotNull(::segmentFromBlock)
        else -> emptyList()
    }

    private fun segmentFromBlock(block: JsonElement): MessageSegment? {
        val obj = block as? JsonObject ?: return null
        return when (obj.str("type")) {
            "text" -> obj.str("text")?.takeIf { it.isNotEmpty() }?.let { MessageSegment.Text(it) }
            "thinking" -> obj.str("thinking")?.takeIf { it.isNotEmpty() }?.let { MessageSegment.Thinking(it) }
            "tool_use" -> MessageSegment.ToolUse(obj.str("name") ?: "tool", compact(obj["input"]))
            "tool_result" -> MessageSegment.ToolResult(flatten(obj["content"]))
            else -> null
        }
    }

    private fun flatten(content: JsonElement?): String = when (content) {
        null, is JsonNull -> ""
        is JsonPrimitive -> content.contentOrNull.orEmpty()
        is JsonArray -> content.mapNotNull { (it as? JsonObject)?.str("text") }.joinToString("\n")
        else -> ""
    }

    /** A short single-line preview for a tool-use chip. */
    private fun compact(el: JsonElement?): String? = when (el) {
        null, is JsonNull -> null
        is JsonPrimitive -> el.contentOrNull
        is JsonArray -> "[" + el.joinToString(", ") { compact(it) ?: "null" } + "]"
        is JsonObject -> "{" + el.entries.joinToString(", ") { "${it.key}: ${compact(it.value) ?: "null"}" } + "}"
        else -> null
    }

    private fun parseTimestamp(s: String): Long? =
        try { Instant.parse(s).toEpochMilli() }
        catch (e: Exception) {
            try { OffsetDateTime.parse(s).toInstant().toEpochMilli() } catch (e2: Exception) { null }
        }

    private fun JsonObject.str(key: String): String? =
        (this[key] as? JsonPrimitive)?.let { if (it is JsonNull) null else it.contentOrNull }
}
