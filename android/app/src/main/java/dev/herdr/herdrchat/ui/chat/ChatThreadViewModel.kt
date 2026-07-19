package dev.herdr.herdrchat.ui.chat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.herdr.herdrchat.core.client.HerdrClient
import dev.herdr.herdrchat.core.client.TranscriptStore
import dev.herdr.herdrchat.core.model.AgentInfo
import dev.herdr.herdrchat.core.model.AgentStatus
import dev.herdr.herdrchat.core.model.HerdrException
import dev.herdr.herdrchat.core.transcript.ChatMessage
import dev.herdr.herdrchat.core.transcript.MessageSegment
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * Drives one workspace thread: tails the transcript(s) of the agent(s) in the
 * workspace into chat bubbles, tracks live blocked/typing state, and sends
 * replies back through herdr.
 */
class ChatThreadViewModel(
    private val client: HerdrClient,
    summary: ChatSummary,
) {
    val title: String = summary.title
    private val workspaceId: String = summary.workspaceId
    private val store = TranscriptStore(client.transport)

    var messages by mutableStateOf<List<ChatMessage>>(emptyList())
        private set
    var liveAgents by mutableStateOf(summary.agents)
        private set
    var draft by mutableStateOf("")
    var error by mutableStateOf<String?>(null)
        private set
    var isSending by mutableStateOf(false)
        private set

    private val seenIds = mutableSetOf<String>()
    private val arrival = mutableListOf<ChatMessage>()      // real transcript bubbles, in order
    private val localEchoes = mutableListOf<ChatMessage>()  // optimistic user sends, pre-transcript
    private val tailJobs = mutableListOf<Job>()
    private var statusJob: Job? = null
    private var scope: CoroutineScope? = null

    init {
        // Seed from the process cache so reopening a chat shows its history
        // instantly instead of re-reading the whole transcript.
        val cached = ThreadCache.messages(workspaceId)
        if (cached.isNotEmpty()) {
            arrival.addAll(cached)
            seenIds.addAll(ThreadCache.seenIds(workspaceId))
            messages = arrival.toList()
        }
    }

    /** The agent pane a reply is typed into (focused agent, else first). */
    val primaryPane: AgentInfo?
        get() = liveAgents.firstOrNull { it.focused }
            ?: liveAgents.firstOrNull { it.agent != null }
            ?: liveAgents.firstOrNull()

    /** A blocked agent pane in this workspace, if any (drives quick replies). */
    val blockedPane: AgentInfo? get() = liveAgents.firstOrNull { it.agentStatus == AgentStatus.BLOCKED }

    val isBlocked: Boolean get() = blockedPane != null

    /** Aggregate presence for the header, most-urgent-wins. */
    val status: AgentStatus
        get() = when {
            liveAgents.any { it.agentStatus == AgentStatus.BLOCKED } -> AgentStatus.BLOCKED
            liveAgents.any { it.agentStatus == AgentStatus.WORKING } -> AgentStatus.WORKING
            liveAgents.any { it.agentStatus == AgentStatus.DONE } -> AgentStatus.DONE
            liveAgents.isNotEmpty() -> AgentStatus.IDLE
            else -> AgentStatus.UNKNOWN
        }

    fun start(scope: CoroutineScope) {
        this.scope = scope
        startStatusPolling(scope)
        scope.launch { startTails(scope) }
    }

    fun stop() {
        tailJobs.forEach { it.cancel() }
        tailJobs.clear()
        statusJob?.cancel()
        statusJob = null
    }

    // MARK: - Reading

    private suspend fun startTails(scope: CoroutineScope) {
        // One transcript tail per agent that owns a conversation.
        val agents = liveAgents.filter { it.agent != null }
        for (agent in agents) {
            val path = runCatching { store.newestTranscriptPath(agent.cwd) }.getOrNull() ?: continue
            val label = if (agents.size > 1) agent.agent else null
            val cachedBytes = ThreadCache.consumedBytes(workspaceId, path)
            val size = runCatching { store.fileSize(path) }.getOrNull() ?: -1L
            val canResume = cachedBytes != null && size >= cachedBytes

            val followStart: Long
            if (canResume) {
                // Reopen: history already cached; just follow from where we left off.
                followStart = cachedBytes!!
            } else {
                // First open: bulk-load only the recent slice in ONE read + ONE
                // batch (not line-by-line), then follow new appends live.
                ThreadCache.resetBytes(workspaceId, path)
                val recent = runCatching { store.recent(path, label, RECENT_BYTES) }.getOrNull()
                if (recent != null) {
                    ingestBatch(recent.messages)
                    ThreadCache.setConsumedBytes(workspaceId, path, recent.consumedBytes)
                    followStart = recent.consumedBytes
                } else {
                    followStart = 0L
                }
            }

            val job = scope.launch {
                try {
                    store.tail(path, label, followStart).collect { chunk ->
                        chunk.message?.let { ingest(it) }
                        ThreadCache.setConsumedBytes(workspaceId, path, chunk.consumedBytes)
                    }
                } catch (e: Exception) {
                    setError(e)
                }
            }
            tailJobs.add(job)
        }
    }

    private fun ingest(message: ChatMessage) {
        if (!seenIds.add(message.id)) return
        ThreadCache.add(workspaceId, message)
        arrival.add(message)
        rebuild()
    }

    /** Ingest many messages with a single rebuild (used for the initial bulk load). */
    private fun ingestBatch(incoming: List<ChatMessage>) {
        var added = false
        for (message in incoming) {
            if (seenIds.add(message.id)) {
                ThreadCache.add(workspaceId, message)
                arrival.add(message)
                added = true
            }
        }
        if (added) rebuild()
    }

    private fun startStatusPolling(scope: CoroutineScope) {
        statusJob = scope.launch {
            while (isActive) {
                runCatching { client.snapshot() }.getOrNull()?.let { snapshot ->
                    liveAgents = snapshot.agents.filter { it.workspaceId == workspaceId }
                }
                delay(2000)
            }
        }
    }

    private fun rebuild() {
        // Drop optimistic echoes once the real user turn has landed.
        val realUserTexts = arrival
            .filter { it.role == ChatMessage.Role.USER }
            .map { it.displayText.trim() }
            .toSet()
        localEchoes.removeAll { realUserTexts.contains(it.displayText.trim()) }
        messages = arrival + localEchoes
    }

    private fun setError(e: Throwable) {
        error = (e as? HerdrException)?.message ?: e.message ?: e.toString()
    }

    // MARK: - Writing

    fun send() {
        val s = scope ?: return
        val text = draft.trim()
        val pane = primaryPane
        if (text.isEmpty() || pane == null) return
        draft = ""
        isSending = true
        // Optimistic echo so the bubble appears instantly.
        val echo = ChatMessage(
            id = "local-${UUID.randomUUID()}",
            role = ChatMessage.Role.USER,
            segments = listOf(MessageSegment.Text(text)),
            timestamp = null,
        )
        localEchoes.add(echo)
        rebuild()
        s.launch {
            runCatching { client.sendMessage(pane.paneId, text) }.onFailure { setError(it) }
            isSending = false
        }
    }

    /** Quick reply to a blocked prompt (e.g. "enter", "1", "escape"). */
    fun sendKeys(keys: List<String>) {
        val s = scope ?: return
        val pane = blockedPane ?: primaryPane ?: return
        s.launch {
            runCatching { client.sendKeys(pane.paneId, keys) }.onFailure { setError(it) }
        }
    }

    companion object {
        // Only bulk-load this many bytes of a fresh transcript up front; older
        // history stays on disk. Keeps the first open fast even on huge sessions.
        private const val RECENT_BYTES = 400_000L
    }
}
