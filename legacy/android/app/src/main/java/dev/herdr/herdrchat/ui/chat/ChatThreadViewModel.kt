package dev.herdr.herdrchat.ui.chat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.herdr.herdrchat.core.client.HerdrClient
import dev.herdr.herdrchat.core.client.RecentLoad
import dev.herdr.herdrchat.core.client.TranscriptStore
import dev.herdr.herdrchat.core.model.AgentInfo
import dev.herdr.herdrchat.core.model.AgentStatus
import dev.herdr.herdrchat.core.model.HerdrException
import dev.herdr.herdrchat.core.transcript.BlockedPrompt
import dev.herdr.herdrchat.core.transcript.BlockedPromptParser
import dev.herdr.herdrchat.core.transcript.ChatMessage
import dev.herdr.herdrchat.core.transcript.LivePreviewExtractor
import dev.herdr.herdrchat.core.transcript.MessageSegment
import dev.herdr.herdrchat.core.transcript.SessionMeta
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
 *
 * Lifecycle: owned by [ThreadSessions] (app-scoped), NOT by the screen — so
 * navigating away keeps the tails alive and coming back is instant. The status
 * poll doubles as a health loop: it restarts dead tails after a connection blip
 * and follows transcript file rotation (new session files).
 */
class ChatThreadViewModel(
    private val client: HerdrClient,
    private val connectionId: String,
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
    var failedEchoIds by mutableStateOf<Set<String>>(emptySet())
        private set
    /** Parsed choice menu of a blocked agent (question + numbered options), so the
     *  quick-reply bar can label each option. Null when not blocked or unparsable. */
    var blockedPrompt by mutableStateOf<BlockedPrompt?>(null)
        private set
    /** Model + context size for the header, refreshed from the transcript tail. */
    var sessionMeta by mutableStateOf<SessionMeta?>(null)
        private set
    /** Best-effort live preview of the agent's in-progress answer (scraped from the
     *  visible screen while working); null falls back to the waiting bar. */
    var livePreview by mutableStateOf<String?>(null)
        private set

    /** Folder name of the agent's working directory, for the header. */
    val workingDirName: String? get() = primaryPane?.cwd?.substringAfterLast('/')?.ifEmpty { null }

    private var metaTick = 0
    private val seenIds = mutableSetOf<String>()
    private val arrival = mutableListOf<ChatMessage>()      // real transcript bubbles, in order
    private val localEchoes = mutableListOf<ChatMessage>()  // optimistic user sends, pre-transcript
    private val tailJobs = mutableMapOf<String, Job>()          // agent cwd -> follow job
    private val tailedPaths = mutableMapOf<String, String>()    // agent cwd -> transcript path
    private val tailedSessions = mutableMapOf<String, String?>() // agent cwd -> session id (when known)
    /** The session signature whose history is currently loaded. A chat's identity
     *  is its Claude session(s), not its workspace slot — so when this changes
     *  (workspace reused by a new chat, or a live rotation) the old history is
     *  dropped instead of shown/appended-to. */
    private var boundSig: String? = null
    private val deadTails = mutableSetOf<String>()              // agent cwds whose tail ended
    /** Monotonic source of tail ids, and the generation currently live for each
     *  agent. The fence is PER AGENT: a late chunk from a superseded tail is
     *  dropped, but starting a tail for a newly-resolved agent must not fence off
     *  the healthy tails already running beside it (one shared counter did exactly
     *  that, silently muting live threads). */
    private var tailGeneration = 0
    private val tailGenerations = mutableMapOf<String, Int>()    // agent cwd -> live generation
    private var statusJob: Job? = null
    private var scope: CoroutineScope? = null
    private var started = false
    private var hostHome: String? = null

    val unreadKey: String get() = UnreadStore.key(connectionId, workspaceId)

    init {
        // Seed from the disk-backed cache so reopening (even after an app restart)
        // shows history instantly — but ONLY when the cache belongs to the same
        // session that's live now. If this workspace was reused by a new chat
        // (same agent name), seeding is skipped so old history can't appear.
        val initSig = sessionSignature(summary.agents)
        val cachedSig = ThreadCache.sessionSig(connectionId, workspaceId)
        if (initSig == null || initSig == cachedSig) {
            val cached = ThreadCache.messages(connectionId, workspaceId)
            if (cached.isNotEmpty()) {
                // Seed only the newest slice: the cache holds more than a chat
                // surface should render on open.
                arrival.addAll(
                    if (cached.size > RECENT_MESSAGES) cached.takeLast(RECENT_MESSAGES) else cached
                )
                // Keep the FULL seen set (not just the seeded slice) so the tail
                // can't re-add the history we deliberately trimmed away.
                seenIds.addAll(ThreadCache.seenIds(connectionId, workspaceId))
                messages = arrival.toList()
            }
        }
        bindSession(initSig)
    }

    /** Point this thread at [sig]. When it differs from the loaded history's
     *  session — a new chat reusing this workspace, or a live rotation — the
     *  stale history is dropped (in memory and on disk) so it can't bleed into
     *  the new conversation. No-op while the session is still unknown. */
    private fun bindSession(sig: String?) {
        if (sig == null || sig == boundSig) return
        if (ThreadCache.rebind(connectionId, workspaceId, sig)) resetHistory()
        boundSig = sig
    }

    /** Drop all loaded history (in memory; the disk cache is cleared by
     *  ThreadCache.rebind). Used when the thread switches to a new session. */
    private fun resetHistory() {
        arrival.clear()
        localEchoes.clear()
        seenIds.clear()
        failedEchoIds = emptySet()
        messages = emptyList()
    }

    /** Aggregate presence for the header, most-urgent-wins. */
    val status: AgentStatus
        get() = when {
            liveAgents.any { it.agentStatus == AgentStatus.BLOCKED } -> AgentStatus.BLOCKED
            liveAgents.any { it.agentStatus == AgentStatus.WORKING } -> AgentStatus.WORKING
            liveAgents.any { it.agentStatus == AgentStatus.DONE } -> AgentStatus.DONE
            liveAgents.isNotEmpty() -> AgentStatus.IDLE
            else -> AgentStatus.UNKNOWN
        }

    /** The agent pane a reply is typed into (focused agent, else first). */
    val primaryPane: AgentInfo?
        get() = liveAgents.firstOrNull { it.focused }
            ?: liveAgents.firstOrNull { it.agent != null }
            ?: liveAgents.firstOrNull()

    /** A blocked agent pane in this workspace, if any (drives quick replies). */
    val blockedPane: AgentInfo? get() = liveAgents.firstOrNull { it.agentStatus == AgentStatus.BLOCKED }

    val isBlocked: Boolean get() = blockedPane != null

    fun startIfNeeded(scope: CoroutineScope) {
        if (started) return
        started = true
        this.scope = scope
        startStatusPolling(scope)
        scope.launch { startTails(scope) }
    }

    fun stop() {
        cancelTails()
        statusJob?.cancel()
        statusJob = null
        started = false
    }

    fun clearError() { error = null }

    /** Manual refresh: drop in-memory history + byte cursors and re-read the
     *  transcript from disk. Recovers a thread whose live tail drifted into a bad
     *  state (wrong/missing last messages). */
    fun reload() {
        val s = scope ?: return
        s.launch {
            for (path in tailedPaths.values) {
                ThreadCache.resetBytes(connectionId, workspaceId, path)
            }
            cancelTails()
            resetHistory()
            startTails(s)
        }
    }

    // MARK: - Reading

    /** Resolve the transcript to follow for an agent. When the integration
     *  reports a session id (authoritative): wait for exactly that file — never
     *  fall back to the newest `.jsonl`, which would be the PREVIOUS session's
     *  transcript and make a new chat show old history. Only agents with no
     *  session reference use the newest-file guess. */
    private suspend fun transcriptPath(agent: dev.herdr.herdrchat.core.model.AgentInfo): String? {
        val sid = agent.agentSession?.takeIf { it.kind == "id" }?.value
        if (!sid.isNullOrEmpty()) {
            tailedSessions[agent.cwd] = sid
            if (hostHome == null) hostHome = runCatching { store.homeDirectory() }.getOrNull()
            val home = hostHome ?: return null
            val path = store.sessionTranscriptPath(home, agent.cwd, sid) ?: return null
            // The session may be known a moment before its file is written; return
            // null until it exists (the poll retries) rather than tailing a stale one.
            val size = runCatching { store.fileSize(path) }.getOrNull() ?: -1L
            return if (size >= 0L) path else null
        }
        tailedSessions[agent.cwd] = null
        return runCatching { store.newestTranscriptPath(agent.cwd) }.getOrNull()
    }

    /** Ensure every conversation agent in this workspace has a live tail.
     *  ADDITIVE by design: agents already being followed are left strictly alone.
     *  The old version tore down and rebuilt every tail on each call, so a single
     *  agent whose transcript file didn't exist yet (`unresolvedSession`) would, on
     *  every 2 s poll, kill its healthy siblings' tails mid-stream and re-read
     *  their history from scratch — dropping chunks and re-paying the bulk load. */
    private suspend fun startTails(scope: CoroutineScope) {
        val agents = liveAgents.filter { it.agent != null }
        // Bind to the session(s) now in the workspace before loading anything —
        // if they changed (rotation, or a new chat reusing this slot), stale
        // history is dropped here so the reload starts clean.
        bindSession(sessionSignature(agents))
        for (agent in agents) {
            if (tailJobs[agent.cwd] != null) continue   // already following
            startTail(scope, agent, multiAgent = agents.size > 1)
        }
    }

    private suspend fun startTail(scope: CoroutineScope, agent: AgentInfo, multiAgent: Boolean) {
        val cwd = agent.cwd
        // Per-agent generation fence: a chunk or death signal from a superseded
        // tail of THIS agent is dropped, without touching the other agents' live
        // fences. (Lesson from cmux, corrected.)
        tailGeneration += 1
        val generation = tailGeneration
        tailGenerations[cwd] = generation

        val path = transcriptPath(agent) ?: return
        if (tailGenerations[cwd] != generation) return   // superseded mid-resolve
        val label = if (multiAgent) agent.agent else null
        tailedPaths[cwd] = path

        val cachedBytes = ThreadCache.consumedBytes(connectionId, workspaceId, path)
        val size = runCatching { store.fileSize(path) }.getOrNull() ?: -1L
        if (tailGenerations[cwd] != generation) return
        val canResume = cachedBytes != null && size >= cachedBytes

        val followStart: Long
        if (canResume) {
            // Reopen: history cached; follow from just before where we left
            // off (rewind heals a mid-line cursor, dedupe eats the overlap).
            followStart = maxOf(0L, cachedBytes!! - RESUME_REWIND)
        } else {
            // First open (or rotation): bulk-load only the recent slice in
            // ONE read + ONE batch, then follow new appends live.
            ThreadCache.resetBytes(connectionId, workspaceId, path)
            val recent = loadRecent(path, label, size)
            if (recent != null) {
                if (tailGenerations[cwd] != generation) return
                ingestBatch(recent.messages)
                ThreadCache.setConsumedBytes(connectionId, workspaceId, path, recent.consumedBytes)
                followStart = recent.consumedBytes
            } else {
                followStart = 0L
            }
        }

        tailJobs[cwd] = scope.launch {
            try {
                store.tail(path, label, followStart).collect { chunk ->
                    if (tailGenerations[cwd] != generation) return@collect   // superseded tail
                    chunk.message?.let { ingest(it) }
                    ThreadCache.setConsumedBytes(connectionId, workspaceId, path, chunk.consumedBytes)
                }
                if (tailGenerations[cwd] == generation) deadTails.add(cwd)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                if (tailGenerations[cwd] == generation) deadTails.add(cwd)
            }
        }
    }

    /** The up-front history read: a small recent window, widened once if it came
     *  back too thin to be a real conversation (a tail made of one giant base64
     *  line yields almost no bubbles). */
    private suspend fun loadRecent(path: String, label: String?, size: Long): RecentLoad? {
        val first = runCatching {
            store.recent(path, label, RECENT_BYTES, RECENT_MESSAGES)
        }.getOrNull() ?: return null
        if (first.messages.size >= THIN_HISTORY || size <= RECENT_BYTES) return first
        return runCatching {
            store.recent(path, label, RECENT_BYTES_WIDE, RECENT_MESSAGES)
        }.getOrNull() ?: first
    }

    /** Tear down every tail and forget what we were following. */
    private fun cancelTails() {
        tailJobs.values.forEach { it.cancel() }
        tailJobs.clear()
        tailedPaths.clear()
        tailedSessions.clear()
        tailGenerations.clear()
        deadTails.clear()
    }

    /** Tear down one agent's tail (rotation / death), leaving its siblings running. */
    private fun cancelTail(cwd: String) {
        tailJobs.remove(cwd)?.cancel()
        tailedPaths.remove(cwd)
        tailedSessions.remove(cwd)
        tailGenerations.remove(cwd)
        deadTails.remove(cwd)
    }

    /** Keep the tail set in sync with the workspace, per agent: retire tails that
     *  died or whose agent rotated to a new session, then make sure every
     *  conversation agent has one. An agent whose transcript file doesn't exist yet
     *  simply gets no job, so the next poll retries it — no whole-workspace
     *  teardown, which is what used to interrupt the healthy tails. */
    private suspend fun reconcileTails() {
        val s = scope ?: return
        deadTails.toList().forEach { cancelTail(it) }
        rotatedAgentCwds().forEach { cancelTail(it) }
        startTails(s)
    }

    private fun ingest(message: ChatMessage) {
        if (!seenIds.add(message.id)) return
        ThreadCache.add(connectionId, workspaceId, message)
        arrival.add(message)
        // New assistant content while this thread isn't on screen = unread.
        if (message.role == ChatMessage.Role.ASSISTANT && !message.isSidechain) {
            UnreadStore.mark(unreadKey)
        }
        rebuild()
    }

    /** Ingest many messages with a single rebuild (used for the initial bulk load). */
    private fun ingestBatch(incoming: List<ChatMessage>) {
        var added = false
        for (message in incoming) {
            if (seenIds.add(message.id)) {
                ThreadCache.add(connectionId, workspaceId, message)
                arrival.add(message)
                added = true
            }
        }
        if (added) rebuild()
    }

    /** Status poll doubles as tail health/rotation watchdog: it refreshes live
     *  agent presence and restarts tails on rotation or death. */
    private fun startStatusPolling(scope: CoroutineScope) {
        statusJob = scope.launch {
            while (isActive) {
                runCatching { client.snapshot() }.getOrNull()?.let { snapshot ->
                    liveAgents = snapshot.agents.filter { it.workspaceId == workspaceId }
                    if (error?.contains("host_key") != true) error = null
                    reconcileTails()
                    refreshBlockedPrompt()
                    refreshLivePreview()
                    metaTick++
                    if (metaTick % 5 == 1) refreshSessionMeta()
                }
                delay(2000)
            }
        }
    }

    /** Refresh the header's model + context readout from the primary transcript. */
    private suspend fun refreshSessionMeta() {
        val pane = primaryPane ?: return
        val path = tailedPaths[pane.cwd] ?: return
        val meta = runCatching { store.sessionMeta(path) }.getOrNull() ?: return
        if (meta != sessionMeta) sessionMeta = meta
    }

    /** While the agent works, scrape its visible screen into a best-effort live
     *  preview of the answer it's writing; cleared when it stops. */
    private suspend fun refreshLivePreview() {
        val pane = primaryPane
        if (status != AgentStatus.WORKING || pane == null) {
            if (livePreview != null) livePreview = null
            return
        }
        val raw = runCatching { client.paneVisible(pane.paneId, 30) }.getOrNull() ?: return
        livePreview = LivePreviewExtractor.extract(raw)
    }

    /** While an agent is blocked, read its pane and parse the choice menu so the
     *  quick-reply bar can label each option. Cleared when unblocked/unparsable. */
    private suspend fun refreshBlockedPrompt() {
        val pane = blockedPane
        if (pane == null) {
            if (blockedPrompt != null) blockedPrompt = null
            return
        }
        val raw = runCatching { client.paneVisible(pane.paneId, 40) }.getOrNull() ?: return
        val parsed = BlockedPromptParser.parse(raw)
        blockedPrompt = if (parsed.isEmpty) null else parsed
    }

    /** Agents whose session id changed since we started following them — the
     *  authoritative rotation signal (a new Claude conversation = new transcript
     *  file). Agents without a session reference are re-resolved on tail death. */
    private fun rotatedAgentCwds(): List<String> =
        liveAgents.mapNotNull { agent ->
            if (agent.agent == null) return@mapNotNull null
            if (tailedPaths[agent.cwd] == null) return@mapNotNull null   // not tailed yet
            val sid = agent.agentSession?.takeIf { it.kind == "id" }?.value
                ?: return@mapNotNull null
            val tailedSid = tailedSessions[agent.cwd] ?: return@mapNotNull null
            if (tailedSid != sid) agent.cwd else null
        }

    /** Merge transcript arrivals with optimistic echoes chronologically, so an
     *  unconfirmed echo stays at its send position instead of pinning to the
     *  bottom below newer messages. */
    private fun rebuild() {
        // Drop optimistic echoes once the real user turn has landed.
        val realUserTexts = arrival
            .filter { it.role == ChatMessage.Role.USER }
            .map { it.displayText.trim() }
            .toSet()
        localEchoes.removeAll { echo ->
            if (!realUserTexts.contains(echo.displayText.trim())) return@removeAll false
            failedEchoIds = failedEchoIds - echo.id
            true
        }

        if (localEchoes.isEmpty()) {
            messages = arrival.toList()
            return
        }
        val echoes = localEchoes.sortedBy { it.timestamp ?: Long.MIN_VALUE }
        val merged = ArrayList<ChatMessage>(arrival.size + echoes.size)
        var echoIndex = 0
        var lastTime = Long.MIN_VALUE
        for (message in arrival) {
            val effective = message.timestamp ?: lastTime
            lastTime = effective
            while (echoIndex < echoes.size && (echoes[echoIndex].timestamp ?: Long.MAX_VALUE) <= effective) {
                merged.add(echoes[echoIndex]); echoIndex++
            }
            merged.add(message)
        }
        while (echoIndex < echoes.size) { merged.add(echoes[echoIndex]); echoIndex++ }
        messages = merged
    }

    private fun setError(e: Throwable) {
        error = (e as? HerdrException)?.message ?: e.message ?: e.toString()
    }

    // MARK: - Writing

    fun send() {
        val text = draft.trim()
        val pane = primaryPane
        if (text.isEmpty() || pane == null) return
        draft = ""
        // Optimistic echo (timestamped so it merges chronologically).
        val echo = ChatMessage(
            id = "local-${UUID.randomUUID()}",
            role = ChatMessage.Role.USER,
            segments = listOf(MessageSegment.Text(text)),
            timestamp = System.currentTimeMillis(),
        )
        localEchoes.add(echo)
        rebuild()
        deliver(text, echo.id, pane)
    }

    /** Re-send a failed optimistic echo. */
    fun retry(echoId: String) {
        val echo = localEchoes.firstOrNull { it.id == echoId } ?: return
        val pane = primaryPane ?: return
        failedEchoIds = failedEchoIds - echoId
        deliver(echo.displayText, echoId, pane)
    }

    /** Submit + verify. `pane run` types the text and presses Enter, but a busy
     *  TUI can leave the prompt sitting in the composer — so unless the agent
     *  was already working (where a send just queues), require the status to
     *  flip to `working`; if it doesn't, press Enter once more and re-check. */
    private fun deliver(text: String, echoId: String, pane: dev.herdr.herdrchat.core.model.AgentInfo) {
        val s = scope ?: return
        isSending = true
        s.launch {
            val wasWorking = pane.agentStatus == AgentStatus.WORKING
            try {
                client.sendMessage(pane.paneId, text)
                if (!wasWorking) {
                    var accepted = client.waitAgentStatus(pane.paneId, AgentStatus.WORKING, 3500)
                    if (!accepted) {
                        runCatching { client.sendKeys(pane.paneId, listOf("Enter")) }
                        accepted = client.waitAgentStatus(pane.paneId, AgentStatus.WORKING, 2500)
                    }
                    if (!accepted) {
                        failedEchoIds = failedEchoIds + echoId
                        error = "Couldn't confirm delivery — the message may be stuck in the terminal. Try again."
                    }
                }
            } catch (e: Exception) {
                failedEchoIds = failedEchoIds + echoId
                setError(e)
            }
            isSending = false
        }
    }

    /** Quick reply to a blocked prompt (e.g. "Enter", "1", "Escape"). */
    fun sendKeys(keys: List<String>) {
        val s = scope ?: return
        val pane = blockedPane ?: primaryPane ?: return
        s.launch {
            runCatching { client.sendKeys(pane.paneId, keys) }.onFailure { setError(it) }
        }
    }

    companion object {
        /** A stable identity for the conversation(s) a workspace currently hosts:
         *  the sorted, joined Claude session ids of its agents. Null when no agent
         *  reports a session id yet (identity still unknown). */
        private fun sessionSignature(agents: List<AgentInfo>): String? {
            val ids = agents
                .filter { it.agent != null }
                .mapNotNull { it.agentSession?.takeIf { s -> s.kind == "id" }?.value }
                .filter { it.isNotEmpty() }
            if (ids.isEmpty()) return null
            return ids.toSortedSet().joinToString(",")
        }

        // Only bulk-load this many bytes of a fresh transcript up front; older
        // history stays on disk. Keeps the first open fast even on huge sessions.
        private const val RECENT_BYTES = 400_000L
        // Widened window for the pathological case: a transcript whose tail is one
        // enormous line (image tool-results embed base64) can yield almost no
        // bubbles from the small window. Tried once, only when the first read came
        // back too thin to be a real conversation.
        private const val RECENT_BYTES_WIDE = 3_000_000L
        // Bubbles to keep from the initial load. Bytes are a poor proxy for
        // conversation length — a megabyte can hold thousands of terse turns — so
        // this bounds what the list has to lay out on open.
        private const val RECENT_MESSAGES = 150
        // Below this, the bulk load didn't find a real conversation — widen once.
        private const val THIN_HISTORY = 10
        // On resume, rewind this much before the stored offset: if a disconnect
        // left the cursor mid-line, the boundary line is re-read in full (dedupe
        // drops anything already seen), so no message is lost at the seam.
        private const val RESUME_REWIND = 4_096L
    }
}
