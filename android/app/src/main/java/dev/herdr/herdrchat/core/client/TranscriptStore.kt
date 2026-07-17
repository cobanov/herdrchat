package dev.herdr.herdrchat.core.client

import dev.herdr.herdrchat.core.net.HerdrTransport
import dev.herdr.herdrchat.core.net.ShellQuoting
import dev.herdr.herdrchat.core.transcript.ChatMessage
import dev.herdr.herdrchat.core.transcript.TranscriptParser
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.mapNotNull

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

    /** Stream chat messages as they are appended. Emits existing content first
     *  (`tail -n +1`) then follows the file. */
    fun tailMessages(path: String, agentLabel: String?): Flow<ChatMessage> =
        transport.streamLines("tail -n +1 -f ${ShellQuoting.quote(path)}")
            .mapNotNull { TranscriptParser.message(it, agentLabel) }
}
