package dev.herdr.herdrchat.core.client

import dev.herdr.herdrchat.core.net.HerdrTransport
import dev.herdr.herdrchat.core.net.ShellQuoting
import dev.herdr.herdrchat.core.transcript.ChatMessage
import dev.herdr.herdrchat.core.transcript.SessionMeta
import dev.herdr.herdrchat.core.transcript.TranscriptParser
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.mapNotNull

/** One streamed transcript line: the parsed bubble (null for non-message lines)
 *  and the running byte offset consumed, so a re-open can resume from there. */
data class TailChunk(val message: ChatMessage?, val consumedBytes: Long)

/** Result of a bulk "recent" read: parsed bubbles + the byte offset the live
 *  tail should follow from. */
data class RecentLoad(val messages: List<ChatMessage>, val consumedBytes: Long)

/**
 * Reads Claude Code transcripts on the herdr host so chat threads show clean
 * bubbles instead of the raw TUI buffer. Given a pane's cwd, it finds the newest
 * session `.jsonl` under `~/.claude/projects/<escaped-cwd>/` and either loads it
 * once or tails it for live updates.
 */
class TranscriptStore(private val transport: HerdrTransport) {

    /** The host user's home directory (resolve once and cache; stored paths
     *  must be absolute so shell quoting stays safe). */
    suspend fun homeDirectory(): String =
        transport.shell("printf %s \"\$HOME\"").trim().ifEmpty { "~" }

    /** Exact transcript path for a known agent session id — authoritative
     *  (herdr's `agent_session.value` IS the transcript filename for Claude). */
    fun sessionTranscriptPath(home: String, cwd: String, sessionId: String): String? {
        if (sessionId.isEmpty() || !sessionId.all { it.isLetterOrDigit() || it == '-' }) return null
        val dir = TranscriptParser.projectDirName(cwd)
        return "$home/.claude/projects/$dir/$sessionId.jsonl"
    }

    /** Path to the most recently modified transcript for a working directory,
     *  or null if the agent has no transcript there yet. */
    suspend fun newestTranscriptPath(cwd: String): String? {
        val dir = TranscriptParser.projectDirName(cwd)
        // dir is [A-Za-z0-9-] only, safe to interpolate; $HOME expands on the host.
        val command = "ls -t \"\$HOME/.claude/projects/$dir\"/*.jsonl 2>/dev/null | head -1"
        val path = transport.shell(command).trim()
        return path.ifEmpty { null }
    }

    /** Load and parse a transcript file in full. */
    suspend fun loadMessages(path: String, agentLabel: String?): List<ChatMessage> =
        TranscriptParser.parse(transport.shell("cat ${ShellQuoting.quote(path)}"), agentLabel)

    /** Bulk-load only the most recent [maxBytes] of a transcript in one read and
     *  parse, instead of streaming the whole (possibly multi-MB) file line by
     *  line. A partial first line (window starts mid-file) fails to parse and is
     *  dropped. Returns the bubbles + the byte offset consumed for the tail. */
    suspend fun recent(path: String, agentLabel: String?, maxBytes: Long): RecentLoad {
        val size = fileSize(path)
        val start = if (size > maxBytes) size - maxBytes else 0L
        val text = transport.shell("tail -c +${start + 1} ${ShellQuoting.quote(path)}")
        val messages = TranscriptParser.parse(text, agentLabel)
        return RecentLoad(messages, start + text.toByteArray(Charsets.UTF_8).size)
    }

    /** Model + context size for the chat header: read the transcript tail and take
     *  the newest assistant line's model and prompt-token total. One small
     *  round-trip; null when the tail holds no assistant turn with usage yet. */
    suspend fun sessionMeta(path: String, tailBytes: Int = 262_144): SessionMeta? {
        val text = transport.shell("tail -c $tailBytes ${ShellQuoting.quote(path)} 2>/dev/null")
        var model: String? = null
        var ctx: Int? = null
        for (line in text.split("\n").asReversed()) {
            val meta = TranscriptParser.assistantMeta(line) ?: continue
            if (model == null) model = meta.model
            if (ctx == null) ctx = meta.contextTokens
            if (model != null && ctx != null) break
        }
        return if (model == null && ctx == null) null else SessionMeta(model, ctx)
    }

    /** Current file size in bytes, or -1 if unknown. Used to decide whether a
     *  cached byte offset is still valid (file grew) or the file rotated. */
    suspend fun fileSize(path: String): Long =
        transport.shell("wc -c < ${ShellQuoting.quote(path)} 2>/dev/null").trim().toLongOrNull() ?: -1

    /** Stream transcript lines from [startByte] to end, then follow appends.
     *  `startByte = 0` reads the whole file. Each chunk carries the running byte
     *  offset so the caller can persist it and resume later without re-reading. */
    fun tail(path: String, agentLabel: String?, startByte: Long): Flow<TailChunk> = flow {
        var consumed = startByte
        transport.streamLines("tail -c +${startByte + 1} -f ${ShellQuoting.quote(path)}").collect { line ->
            consumed += line.toByteArray(Charsets.UTF_8).size + 1  // + newline
            emit(TailChunk(TranscriptParser.message(line, agentLabel), consumed))
        }
    }
}
