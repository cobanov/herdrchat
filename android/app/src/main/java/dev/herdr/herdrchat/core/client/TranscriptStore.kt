package dev.herdr.herdrchat.core.client

import dev.herdr.herdrchat.core.net.HerdrTransport
import dev.herdr.herdrchat.core.net.ShellQuoting
import dev.herdr.herdrchat.core.transcript.ChatMessage
import dev.herdr.herdrchat.core.transcript.TranscriptParser
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.mapNotNull

/** One streamed transcript line: the parsed bubble (null for non-message lines)
 *  and the running byte offset consumed, so a re-open can resume from there. */
data class TailChunk(val message: ChatMessage?, val consumedBytes: Long)

/**
 * Reads Claude Code transcripts on the herdr host so chat threads show clean
 * bubbles instead of the raw TUI buffer. Given a pane's cwd, it finds the newest
 * session `.jsonl` under `~/.claude/projects/<escaped-cwd>/` and either loads it
 * once or tails it for live updates.
 */
class TranscriptStore(private val transport: HerdrTransport) {

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
