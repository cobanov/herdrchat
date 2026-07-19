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
        } catch (e: Exception) {
            connectionError = (e as? HerdrException)?.message ?: e.message ?: e.toString()
        }
        isLoading = false
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
}
