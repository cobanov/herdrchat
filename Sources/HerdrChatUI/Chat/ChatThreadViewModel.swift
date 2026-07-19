import Foundation
import Observation
import HerdrKit

/// Drives one workspace thread: tails the transcript(s) of the agent(s) in the
/// workspace into chat bubbles, tracks live blocked/typing state, and sends
/// replies back through herdr.
///
/// Orchestration follows herdr's documented model: transcripts are targeted by
/// the agent's native session reference (`agent_session.value` IS the Claude
/// transcript filename) instead of guessing the newest file; sends are verified
/// with `agent wait --status working` and re-submitted once with a real Enter
/// if the prompt stayed in the composer; and rotation is detected by session-id
/// change. Owned by `ThreadSessions` (app-scoped), NOT the view, so navigating
/// away keeps tails alive and coming back is instant.
@MainActor
@Observable
public final class ChatThreadViewModel {
    public let title: String
    public private(set) var messages: [ChatMessage] = []
    public private(set) var liveAgents: [AgentInfo]
    public var draft: String = ""
    public private(set) var error: String?
    public private(set) var isSending = false
    public private(set) var failedEchoIDs: Set<String> = []
    /// The parsed choice menu of a blocked agent (question + numbered options),
    /// so the quick-reply bar shows what each option does. Nil when not blocked
    /// or when no menu could be parsed from the pane.
    public private(set) var blockedPrompt: BlockedPrompt?

    private let client: HerdrClient
    private let store: TranscriptStore
    private let connectionID: String
    private let workspaceId: String

    private var seenIDs = Set<String>()
    private var arrival: [ChatMessage] = []          // real transcript bubbles, in order
    private var localEchoes: [ChatMessage] = []      // optimistic user sends, pre-transcript
    private var tailTasks: [Task<Void, Never>] = []
    private var tailedPaths: [String: String] = [:]      // agent cwd -> transcript path
    private var tailedSessions: [String: String] = [:]   // agent cwd -> session id (when known)
    /// The session signature whose history is currently loaded. A chat's identity
    /// is its Claude session(s), not its workspace slot — so when this changes
    /// (workspace reused by a new chat, or a live rotation) the old history is
    /// dropped instead of shown/appended-to.
    private var boundSig: String?
    private var tailsDead = false
    private var statusTask: Task<Void, Never>?
    private var started = false
    private var hostHome: String?

    /// Only bulk-load this many bytes of a fresh transcript up front; older
    /// history stays on disk. Sized in megabytes because a single transcript
    /// LINE can be one (image tool-results embed base64 payloads) — a smaller
    /// window can land inside one giant line and open a rich session with just
    /// a bubble or two of history. One-time cost per thread; reopens resume
    /// from the cached byte offset.
    private static let recentBytes = 3_000_000
    /// On resume, rewind this much before the stored offset: if a disconnect
    /// left the cursor mid-line, the boundary line is re-read in full (dedupe
    /// drops anything already seen), so no message is lost at the seam.
    private static let resumeRewind = 4_096

    public init(client: HerdrClient, connectionID: String, summary: ChatSummary) {
        self.client = client
        self.store = TranscriptStore(transport: client.transport)
        self.connectionID = connectionID
        self.title = summary.title
        self.workspaceId = summary.workspaceId
        self.liveAgents = summary.agents
        // Seed from the disk-backed cache so reopening (even after an app restart)
        // shows history instantly — but ONLY when the cache belongs to the same
        // session that's live now. If this workspace was reused by a new chat
        // (same agent name), seeding is skipped so the old history can't appear.
        let initSig = summary.agents.sessionSignature
        let cachedSig = ThreadCache.shared.sessionSig(connectionID, summary.workspaceId)
        if initSig == nil || initSig == cachedSig {
            let cached = ThreadCache.shared.messages(connectionID, summary.workspaceId)
            if !cached.isEmpty {
                arrival = cached
                seenIDs = ThreadCache.shared.seenIDs(connectionID, summary.workspaceId)
                rebuild()
            }
        }
        bindSession(initSig)
    }

    /// Point this thread at `sig`. When it differs from the loaded history's
    /// session — a new chat reusing this workspace, or a live rotation — the
    /// stale history is dropped (both in memory and on disk) so it can't bleed
    /// into the new conversation. No-op while the session is still unknown.
    private func bindSession(_ sig: String?) {
        guard let sig, sig != boundSig else { return }
        if ThreadCache.shared.rebind(connectionID, workspaceId, sessionSig: sig) {
            resetHistory()
        }
        boundSig = sig
    }

    /// Drop all loaded history (in-memory only; the disk cache is cleared by
    /// `ThreadCache.rebind`). Used when the thread switches to a new session.
    private func resetHistory() {
        arrival.removeAll()
        localEchoes.removeAll()
        seenIDs.removeAll()
        failedEchoIDs.removeAll()
        messages = []
    }

    var unreadKey: String { UnreadStore.key(connectionID, workspaceId) }

    /// Aggregate presence for the header, most-urgent-wins.
    public var status: AgentStatus {
        if liveAgents.contains(where: { $0.agentStatus == .blocked }) { return .blocked }
        if liveAgents.contains(where: { $0.agentStatus == .working }) { return .working }
        if liveAgents.contains(where: { $0.agentStatus == .done }) { return .done }
        return liveAgents.isEmpty ? .unknown : .idle
    }

    /// The agent pane a reply is typed into (focused agent, else first).
    public var primaryPane: AgentInfo? {
        liveAgents.first { $0.focused } ?? liveAgents.first { $0.agent != nil } ?? liveAgents.first
    }

    /// A blocked agent pane in this workspace, if any (drives quick replies).
    public var blockedPane: AgentInfo? {
        liveAgents.first { $0.agentStatus == .blocked }
    }

    public var isBlocked: Bool { blockedPane != nil }

    public func startIfNeeded() {
        guard !started else { return }
        started = true
        startStatusPolling()
        Task { await startTails() }
    }

    public func stop() {
        tailTasks.forEach { $0.cancel() }
        tailTasks.removeAll()
        tailedPaths.removeAll()
        tailedSessions.removeAll()
        statusTask?.cancel()
        statusTask = nil
        started = false
    }

    public func clearError() { error = nil }

    // MARK: - Reading

    /// Resolve the transcript to follow for an agent. When the integration
    /// reports a session id (authoritative) that IS the target: wait for exactly
    /// that file — never fall back to the newest `.jsonl`, which would be the
    /// PREVIOUS session's transcript and make a new chat show old history. Only
    /// agents with no session reference use the newest-file guess.
    private func transcriptPath(for agent: AgentInfo) async -> String? {
        if agent.agentSession?.kind == "id", let sid = agent.agentSession?.value, !sid.isEmpty {
            tailedSessions[agent.cwd] = sid
            if hostHome == nil { hostHome = try? await store.homeDirectory() }
            guard let home = hostHome,
                  let path = store.sessionTranscriptPath(home: home, cwd: agent.cwd, sessionId: sid) else {
                return nil
            }
            // The session may be known a moment before its file is written; return
            // nil until it exists (the poll retries) rather than tailing a stale one.
            let size = (try? await store.fileSize(atPath: path)) ?? -1
            return size >= 0 ? path : nil
        }
        tailedSessions[agent.cwd] = nil
        return try? await store.newestTranscriptPath(forCwd: agent.cwd)
    }

    private func startTails() async {
        // One transcript tail per agent that owns a conversation.
        let agents = liveAgents.filter { $0.agent != nil }
        // Bind to the session(s) now in the workspace before loading anything —
        // if they changed (rotation, or a new chat reusing this slot), stale
        // history is dropped here so the reload starts clean.
        bindSession(agents.sessionSignature)
        for agent in agents {
            guard let path = await transcriptPath(for: agent) else { continue }
            let label = agents.count > 1 ? agent.agent : nil
            tailedPaths[agent.cwd] = path

            let cachedBytes = ThreadCache.shared.bytes(connectionID, workspaceId, path: path)
            let size = (try? await store.fileSize(atPath: path)) ?? -1
            let canResume = cachedBytes.map { size >= $0 } ?? false

            let followStart: Int
            if canResume {
                followStart = max(0, cachedBytes! - Self.resumeRewind)
            } else {
                ThreadCache.shared.resetBytes(connectionID, workspaceId, path: path)
                if let recent = try? await store.recent(atPath: path, agentLabel: label, maxBytes: Self.recentBytes) {
                    ingestBatch(recent.messages)
                    ThreadCache.shared.setBytes(connectionID, workspaceId, path: path, recent.consumedBytes)
                    followStart = recent.consumedBytes
                } else {
                    followStart = 0
                }
            }

            let stream = store.tail(atPath: path, agentLabel: label, startByte: followStart)
            let task = Task { [weak self] in
                do {
                    for try await chunk in stream {
                        await self?.ingestChunk(chunk, path: path)
                    }
                    await self?.markTailsDead()
                } catch is CancellationError {
                    // intentional stop
                } catch {
                    await self?.markTailsDead()
                }
            }
            tailTasks.append(task)
        }
    }

    private func markTailsDead() { tailsDead = true }

    private func restartTails() async {
        tailTasks.forEach { $0.cancel() }
        tailTasks.removeAll()
        tailedPaths.removeAll()
        tailedSessions.removeAll()
        await startTails()
    }

    private func ingestChunk(_ chunk: TailChunk, path: String) {
        if let message = chunk.message { ingest(message) }
        ThreadCache.shared.setBytes(connectionID, workspaceId, path: path, chunk.consumedBytes)
    }

    private func ingest(_ message: ChatMessage) {
        guard !seenIDs.contains(message.id) else { return }
        seenIDs.insert(message.id)
        ThreadCache.shared.add(connectionID, workspaceId, message)
        arrival.append(message)
        // New assistant content while this thread isn't on screen = unread.
        if message.role == .assistant, !message.isSidechain {
            UnreadStore.shared.mark(unreadKey)
        }
        rebuild()
    }

    /// Ingest many messages with a single rebuild (used for the initial bulk load).
    private func ingestBatch(_ incoming: [ChatMessage]) {
        var added = false
        for message in incoming where !seenIDs.contains(message.id) {
            seenIDs.insert(message.id)
            ThreadCache.shared.add(connectionID, workspaceId, message)
            arrival.append(message)
            added = true
        }
        if added { rebuild() }
    }

    /// Status poll doubles as tail health/rotation watchdog: it refreshes live
    /// agent presence and restarts tails on rotation or death.
    private func startStatusPolling() {
        statusTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                if let snapshot = try? await self.client.snapshot() {
                    self.liveAgents = snapshot.agents.filter { $0.workspaceId == self.workspaceId }
                    if self.error?.contains("host_key") != true { self.error = nil }
                    if self.tailsDead {
                        self.tailsDead = false
                        await self.restartTails()
                    } else if self.rotationDetected() || self.unresolvedSession() {
                        await self.restartTails()
                    }
                    await self.refreshBlockedPrompt()
                }
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    /// While an agent is blocked, read its pane and parse the choice menu so the
    /// quick-reply bar can label each option. Cleared as soon as it's unblocked
    /// or when no menu can be parsed (the bar then shows its generic chips).
    private func refreshBlockedPrompt() async {
        guard let pane = blockedPane else {
            if blockedPrompt != nil { blockedPrompt = nil }
            return
        }
        guard let raw = try? await client.paneTail(pane: pane.paneId, lines: 30) else { return }
        let parsed = BlockedPromptParser.parse(raw)
        blockedPrompt = parsed.isEmpty ? nil : parsed
    }

    /// A conversation agent whose session id is known but whose transcript file
    /// isn't tailed yet (still being written at session start). Keeps the poll
    /// retrying resolution so the new chat fills in — without ever tailing the
    /// previous session's file in the meantime.
    private func unresolvedSession() -> Bool {
        liveAgents.contains { agent in
            agent.agent != nil
                && agent.agentSession?.kind == "id"
                && agent.agentSession?.value?.isEmpty == false
                && tailedPaths[agent.cwd] == nil
        }
    }

    /// Session-id change is the authoritative rotation signal (a new Claude
    /// conversation = new transcript file). Agents without a session reference
    /// fall back to being re-resolved on tail death only.
    private func rotationDetected() -> Bool {
        for agent in liveAgents where agent.agent != nil {
            guard tailedPaths[agent.cwd] != nil else { continue }   // not tailed yet
            if let sid = agent.agentSession?.value, agent.agentSession?.kind == "id",
               let tailedSid = tailedSessions[agent.cwd], tailedSid != sid {
                return true
            }
        }
        return false
    }

    /// Merge transcript arrivals with optimistic echoes chronologically, so an
    /// unconfirmed echo stays at its send position instead of pinning to the
    /// bottom below newer messages.
    private func rebuild() {
        let confirmedTexts = Set(arrival.filter { $0.role == .user }.map { $0.displayText.normalized })
        localEchoes.removeAll { echo in
            guard confirmedTexts.contains(echo.displayText.normalized) else { return false }
            failedEchoIDs.remove(echo.id)
            return true
        }

        guard !localEchoes.isEmpty else {
            messages = arrival
            return
        }
        // Assign every arrival an effective timestamp (carrying the last known
        // one forward), then merge the two time-ordered lists.
        var merged: [ChatMessage] = []
        merged.reserveCapacity(arrival.count + localEchoes.count)
        let echoes = localEchoes.sorted { ($0.timestamp ?? .distantPast) < ($1.timestamp ?? .distantPast) }
        var echoIndex = 0
        var lastTime = Date.distantPast
        for message in arrival {
            let effective = message.timestamp ?? lastTime
            lastTime = effective
            while echoIndex < echoes.count, (echoes[echoIndex].timestamp ?? .distantFuture) <= effective {
                merged.append(echoes[echoIndex])
                echoIndex += 1
            }
            merged.append(message)
        }
        while echoIndex < echoes.count {
            merged.append(echoes[echoIndex])
            echoIndex += 1
        }
        messages = merged
    }

    private func setError(_ error: Error) {
        self.error = (error as? HerdrError)?.description ?? error.localizedDescription
    }

    // MARK: - Writing

    public func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let pane = primaryPane else { return }
        draft = ""
        // Optimistic echo (timestamped so it merges chronologically).
        let echo = ChatMessage(
            id: "local-\(UUID().uuidString)",
            role: .user,
            segments: [.text(text)],
            timestamp: Date()
        )
        localEchoes.append(echo)
        rebuild()
        await deliver(text: text, echoID: echo.id, pane: pane)
    }

    /// Re-send a failed optimistic echo.
    public func retry(echoID: String) async {
        guard let echo = localEchoes.first(where: { $0.id == echoID }),
              let pane = primaryPane else { return }
        failedEchoIDs.remove(echoID)
        await deliver(text: echo.displayText, echoID: echoID, pane: pane)
    }

    /// Submit + verify. `pane run` types the text and presses Enter, but a busy
    /// TUI can leave the prompt sitting in the composer — so unless the agent
    /// was already working (where a send just queues), require the status to
    /// flip to `working`; if it doesn't, press Enter once more and re-check.
    private func deliver(text: String, echoID: String, pane: AgentInfo) async {
        isSending = true
        defer { isSending = false }
        let wasWorking = pane.agentStatus == .working
        do {
            try await client.sendMessage(toPane: pane.paneId, text: text)
            if !wasWorking {
                var accepted = await client.waitAgentStatus(pane: pane.paneId, status: .working, timeoutMs: 3500)
                if !accepted {
                    try await client.sendKeys(toPane: pane.paneId, keys: ["Enter"])
                    accepted = await client.waitAgentStatus(pane: pane.paneId, status: .working, timeoutMs: 2500)
                }
                if !accepted {
                    failedEchoIDs.insert(echoID)
                    error = "Couldn't confirm delivery — the message may be stuck in the terminal. Try again."
                }
            }
        } catch {
            failedEchoIDs.insert(echoID)
            setError(error)
        }
    }

    /// Quick reply to a blocked prompt (e.g. "Enter", "1", "Escape").
    public func sendKeys(_ keys: [String]) async {
        guard let pane = blockedPane ?? primaryPane else { return }
        do {
            try await client.sendKeys(toPane: pane.paneId, keys: keys)
        } catch {
            setError(error)
        }
    }
}

private extension String {
    /// Collapsed whitespace for matching an echo against its transcript turn.
    var normalized: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
