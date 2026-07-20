package dev.herdr.herdrchat.ui.chat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.herdr.herdrchat.core.client.HerdrClient
import dev.herdr.herdrchat.core.model.HerdrException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Drives the chat list: polls the herdr host for workspaces + agent statuses and
 * publishes [ChatSummary] rows. Polling (vs the socket event stream) keeps the
 * SSH transport simple and is plenty responsive for a phone.
 */
class WorkspacesViewModel(
    private val client: HerdrClient,
    private val connectionId: String,
) {

    var summaries by mutableStateOf<List<ChatSummary>>(emptyList())
        private set
    var connectionError by mutableStateOf<String?>(null)
        private set
    var isLoading by mutableStateOf(false)
        private set
    /** True when the last connect failed because herdr isn't installed on the
     *  host account — drives the "Install herdr" recovery button. */
    var herdrMissing by mutableStateOf(false)
        private set
    var isInstallingHerdr by mutableStateOf(false)
        private set
    /** Last directory a workspace was created in, to prefill the new-chat sheet. */
    var lastCwd by mutableStateOf("")
        private set

    private var job: Job? = null
    private val previousStatuses = mutableMapOf<String, dev.herdr.herdrchat.core.model.AgentStatus>()

    fun start(scope: CoroutineScope, pollMillis: Long = 3000) {
        if (job != null) return
        job = scope.launch {
            while (isActive) {
                refresh()
                delay(pollMillis)
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }

    suspend fun refresh() {
        if (summaries.isEmpty()) isLoading = true
        try {
            coroutineScope {
                val workspaces = async { client.workspaces() }
                val snapshot = async { client.snapshot() }
                val rows = ChatSummary.build(workspaces.await(), snapshot.await().agents)
                markUnreadTransitions(rows)
                summaries = rows
            }
            connectionError = null
            herdrMissing = false
        } catch (e: Exception) {
            val herdrError = e as? HerdrException
            connectionError = herdrError?.message ?: e.message ?: e.toString()
            herdrMissing = herdrError?.code == "herdr_not_found"
        }
        isLoading = false
    }

    /** Recovery for the herdr-not-installed case: run the official installer on
     *  the host, then reconnect. */
    fun installHerdr(scope: CoroutineScope) {
        if (isInstallingHerdr) return
        isInstallingHerdr = true
        connectionError = "Installing herdr on the host…"
        scope.launch {
            try {
                client.installHerdr()
                herdrMissing = false
                connectionError = null
                refresh()
            } catch (e: Exception) {
                connectionError = (e as? HerdrException)?.message ?: e.message ?: e.toString()
            }
            isInstallingHerdr = false
        }
    }

    /** working -> done/idle while the thread is off-screen = unread (herdr's
     *  own `done` semantics: finished but not looked at). */
    private fun markUnreadTransitions(rows: List<ChatSummary>) {
        for (row in rows) {
            val previous = previousStatuses[row.workspaceId]
            if (previous == dev.herdr.herdrchat.core.model.AgentStatus.WORKING &&
                (row.status == dev.herdr.herdrchat.core.model.AgentStatus.DONE ||
                    row.status == dev.herdr.herdrchat.core.model.AgentStatus.IDLE)
            ) {
                UnreadStore.mark(UnreadStore.key(connectionId, row.workspaceId))
            }
            previousStatuses[row.workspaceId] = row.status
        }
    }

    /** Distinct working directories already in use, offered as one-tap
     *  suggestions in the new-chat sheet (start another agent in a known repo). */
    val knownCwds: List<String>
        get() = summaries.flatMap { it.agents }.filter { it.agent != null }.map { it.cwd }.distinct()

    /** Create a workspace at [cwd] and start [command] (Claude) in it. Returns the
     *  new workspace's summary once the refresh sees it, so the caller can open the
     *  fresh chat. Null on failure (error is published to [connectionError]). */
    suspend fun createWorkspace(cwd: String, label: String?, command: String = "claude"): ChatSummary? {
        val trimmed = cwd.trim()
        if (trimmed.isEmpty()) return null
        return try {
            val creation = client.createWorkspace(trimmed, label?.trim())
            client.startAgent(creation.rootPane.paneId, command)
            lastCwd = trimmed
            refresh()
            summaries.firstOrNull { it.workspaceId == creation.workspace.workspaceId }
        } catch (e: Exception) {
            connectionError = (e as? HerdrException)?.message ?: e.message ?: e.toString()
            null
        }
    }

    /** Total workspaces currently needing attention (blocked), for the badge. */
    val attentionCount: Int get() = summaries.count { it.needsAttention }

    /** Host home directory for the folder picker's starting point (falls back to
     *  root if the host can't be reached). */
    suspend fun homeDirectory(): String =
        runCatching { client.homeDirectory() }.getOrDefault("/")

    /** Immediate subdirectories of [path] on the host, for the folder picker.
     *  Best-effort: an unreachable host or unreadable path yields an empty list. */
    suspend fun listDirectories(path: String): List<String> =
        runCatching { client.listDirectories(path) }.getOrDefault(emptyList())
}
