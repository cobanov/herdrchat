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
class WorkspacesViewModel(private val client: HerdrClient) {

    var summaries by mutableStateOf<List<ChatSummary>>(emptyList())
        private set
    var connectionError by mutableStateOf<String?>(null)
        private set
    var isLoading by mutableStateOf(false)
        private set

    private var job: Job? = null

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
                summaries = ChatSummary.build(workspaces.await(), snapshot.await().agents)
            }
            connectionError = null
        } catch (e: Exception) {
            connectionError = (e as? HerdrException)?.message ?: e.message ?: e.toString()
        }
        isLoading = false
    }

    /** Total workspaces currently needing attention (blocked), for the badge. */
    val attentionCount: Int get() = summaries.count { it.needsAttention }
}
