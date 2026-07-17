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

    /** The agent pane a reply is typed into (focused agent, else first). */
    val primaryPane: AgentInfo?
        get() = liveAgents.firstOrNull { it.focused }
            ?: liveAgents.firstOrNull { it.agent != null }
            ?: liveAgents.firstOrNull()

    /** A blocked agent pane in this workspace, if any (drives quick replies). */
    val blockedPane: AgentInfo? get() = liveAgents.firstOrNull { it.agentStatus == AgentStatus.BLOCKED }

    val isBlocked: Boolean get() = blockedPane != null

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
            val job = scope.launch {
                try {
                    store.tailMessages(path, label).collect { ingest(it) }
                } catch (e: Exception) {
                    setError(e)
                }
            }
            tailJobs.add(job)
        }
    }

    private fun ingest(message: ChatMessage) {
        if (!seenIds.add(message.id)) return
        arrival.add(message)
        rebuild()
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
}
