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
    /// Model + context size for the header, refreshed from the transcript tail.
    public private(set) var sessionMeta: SessionMeta?
    /// Best-effort live preview of the agent's in-progress answer (scraped from
    /// the pane's visible screen while it works); nil when idle or unparseable,
    /// so the UI falls back to a plain waiting bar.
    public private(set) var livePreview: String?

    /// Folder name of the agent's working directory, for the header.
    public var workingDirName: String? {
        primaryPane?.cwd.split(separator: "/").last.map(String.init)
    }

    private let client: HerdrClient
    private let store: TranscriptStore
    private let connectionID: String
    private let workspaceId: String

    private var seenIDs = Set<String>()
    private var arrival: [ChatMessage] = []          // real transcript bubbles, in order
    private var localEchoes: [ChatMessage] = []      // optimistic user sends, pre-transcript
    private var tailTasks: [String: Task<Void, Never>] = [:]   // agent cwd -> follow task
    private var tailedPaths: [String: String] = [:]      // agent cwd -> transcript path
    private var tailedSessions: [String: String] = [:]   // agent cwd -> session id (when known)
    /// The session signature whose history is currently loaded. A chat's identity
    /// is its Claude session(s), not its workspace slot — so when this changes
    /// (workspace reused by a new chat, or a live rotation) the old history is
    /// dropped instead of shown/appended-to.
    private var boundSig: String?
    private var metaTick = 0
    private var cachedLabels: [String: String] = [:]
    private var deadTails = Set<String>()                // agent cwds whose tail ended
    /// Monotonic source of tail ids, and the generation currently live for each
    /// agent. The fence is PER AGENT: a late chunk from a superseded tail is
    /// dropped, but starting a tail for a newly-resolved agent must not fence off
    /// the healthy tails already running alongside it (one shared counter did
    /// exactly that, silently muting live threads).
    private var tailGeneration = 0
    private var tailGenerations: [String: Int] = [:]      // agent cwd -> live generation
    private var statusTask: Task<Void, Never>?
    private var started = false
    private var hostHome: String?

    /// Bytes of a fresh transcript to pull up front. A chat surface is about
    /// recency, so this is deliberately small: the old 3 MB window meant every
    /// thread open paid a multi-megabyte SSH read and then laid out thousands of
    /// bubbles, which is what made long sessions open mid-history and stutter.
    /// Older history stays on disk. Reopens resume from the cached byte offset
    /// and pay nothing.
    private static let recentBytes = 384_000
    /// Widened window for the pathological case: a transcript whose tail is one
    /// enormous line (image tool-results embed base64 payloads) can yield almost
    /// no bubbles from the small window. Tried once, only when the first read
    /// came back too thin to be a real conversation.
    private static let recentBytesWide = 3_000_000
    /// Bubbles to keep from the initial load, and to seed from the disk cache.
    /// Bounds what the list has to lay out on open regardless of how dense the
    /// byte window turned out to be.
    private static let recentMessages = 150
    /// Below this, the bulk load didn't find a real conversation — widen once.
    private static let thinHistory = 10
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
            var cached = ThreadCache.shared.messages(connectionID, summary.workspaceId)
            if !cached.isEmpty {
                // Seed only the newest slice: the cache holds more than a chat
                // surface should render on open, and a long seed is what the
                // scroll anchor then has to fight its way to the end of.
                if cached.count > Self.recentMessages {
                    cached.removeFirst(cached.count - Self.recentMessages)
                }
                arrival = cached
                // Keep the FULL seen set (not just the seeded slice) so the tail
                // can't re-add the history we deliberately trimmed away.
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
        cancelTails()
        statusTask?.cancel()
        statusTask = nil
        started = false
    }

    /// Tear down every tail and forget what we were following.
    private func cancelTails() {
        tailTasks.values.forEach { $0.cancel() }
        tailTasks.removeAll()
        tailedPaths.removeAll()
        tailedSessions.removeAll()
        tailGenerations.removeAll()
        deadTails.removeAll()
    }

    /// Tear down one agent's tail (rotation / death), leaving its siblings running.
    private func cancelTail(cwd: String) {
        tailTasks[cwd]?.cancel()
        tailTasks[cwd] = nil
        tailedPaths[cwd] = nil
        tailedSessions[cwd] = nil
        tailGenerations[cwd] = nil
        deadTails.remove(cwd)
    }

    public func clearError() { error = nil }

    /// Manual refresh: drop the in-memory history and byte cursors and re-read the
    /// transcript from disk. Recovers a thread whose live tail drifted into a bad
    /// state (wrong/missing last messages) without touching other threads.
    public func reload() async {
        for path in tailedPaths.values {
            ThreadCache.shared.resetBytes(connectionID, workspaceId, path: path)
        }
        cancelTails()
        resetHistory()
        await startTails()
    }

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

    /// Ensure every conversation agent in this workspace has a live tail.
    /// ADDITIVE by design: agents already being followed are left strictly alone.
    /// The old version tore down and rebuilt every tail on each call, so a single
    /// agent whose transcript file didn't exist yet (`unresolvedSession`) would,
    /// on every 2 s poll, kill its healthy siblings' tails mid-stream and re-read
    /// their history from scratch — dropping chunks and re-paying the bulk load.
    private func startTails() async {
        let agents = liveAgents.filter { $0.agent != nil }
        // Bind to the session(s) now in the workspace before loading anything —
        // if they changed (rotation, or a new chat reusing this slot), stale
        // history is dropped here so the reload starts clean.
        bindSession(agents.sessionSignature)
        for agent in agents {
            guard tailTasks[agent.cwd] == nil else { continue }   // already following
            await startTail(for: agent, multiAgent: agents.count > 1)
        }
    }

    private func startTail(for agent: AgentInfo, multiAgent: Bool) async {
        let cwd = agent.cwd
        // Per-agent generation fence: any chunk or death signal arriving from a
        // superseded tail of THIS agent is dropped, without touching the fences
        // of the other agents' live tails. (Lesson from cmux, corrected.)
        tailGeneration += 1
        let generation = tailGeneration
        tailGenerations[cwd] = generation

        guard let path = await transcriptPath(for: agent) else { return }
        guard tailGenerations[cwd] == generation else { return }   // superseded mid-resolve
        let label = multiAgent ? agent.agent : nil
        tailedPaths[cwd] = path

        let cachedBytes = ThreadCache.shared.bytes(connectionID, workspaceId, path: path)
        let size = (try? await store.fileSize(atPath: path)) ?? -1
        guard tailGenerations[cwd] == generation else { return }
        let canResume = cachedBytes.map { size >= $0 } ?? false

        let followStart: Int
        if canResume {
            followStart = max(0, cachedBytes! - Self.resumeRewind)
        } else {
            ThreadCache.shared.resetBytes(connectionID, workspaceId, path: path)
            if let recent = await loadRecent(path: path, label: label, size: size) {
                guard tailGenerations[cwd] == generation else { return }
                ingestBatch(recent.messages)
                ThreadCache.shared.setBytes(connectionID, workspaceId, path: path, recent.consumedBytes)
                followStart = recent.consumedBytes
            } else {
                followStart = 0
            }
        }

        let stream = store.tail(atPath: path, agentLabel: label, startByte: followStart)
        tailTasks[cwd] = Task { [weak self] in
            do {
                for try await chunk in stream {
                    self?.ingestChunk(chunk, path: path, cwd: cwd, generation: generation)
                }
                self?.markTailDead(cwd: cwd, generation: generation)
            } catch is CancellationError {
                // intentional stop
            } catch {
                self?.markTailDead(cwd: cwd, generation: generation)
            }
        }
    }

    /// The up-front history read: a small recent window, widened once if it came
    /// back too thin to be a real conversation (a tail made of one giant
    /// base64 line yields almost no bubbles).
    private func loadRecent(
        path: String,
        label: String?,
        size: Int
    ) async -> (messages: [ChatMessage], consumedBytes: Int)? {
        guard let first = try? await store.recent(
            atPath: path, agentLabel: label,
            maxBytes: Self.recentBytes, maxMessages: Self.recentMessages
        ) else { return nil }
        guard first.messages.count < Self.thinHistory, size > Self.recentBytes else { return first }
        return (try? await store.recent(
            atPath: path, agentLabel: label,
            maxBytes: Self.recentBytesWide, maxMessages: Self.recentMessages
        )) ?? first
    }

    private func markTailDead(cwd: String, generation: Int) {
        guard tailGenerations[cwd] == generation else { return }   // superseded tail
        deadTails.insert(cwd)
    }

    private func ingestChunk(_ chunk: TailChunk, path: String, cwd: String, generation: Int) {
        guard tailGenerations[cwd] == generation else { return }   // late chunk, superseded tail
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
                    await self.reconcileTails()
                    await self.refreshBlockedPrompt()
                    await self.refreshLivePreview()
                    self.metaTick += 1
                    if self.metaTick % 5 == 1 {
                        await self.refreshSessionMeta()
                        await self.refreshWorkspaceLabels()
                    }
                    // Notify about OTHER workspaces while you're inside this thread
                    // (the list poll is paused); never notify for the one you're on.
                    AgentNotifier.diffAndNotify(
                        agents: snapshot.agents,
                        workspaceLabels: self.cachedLabels,
                        excludingWorkspace: self.workspaceId
                    )
                }
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    /// While the agent works, scrape its visible screen into a best-effort live
    /// preview of the answer it's writing; cleared when it stops (the settled
    /// transcript turn then shows the real bubble). Best-effort — nil falls back
    /// to the waiting bar.
    private func refreshLivePreview() async {
        guard status == .working, let pane = primaryPane else {
            if livePreview != nil { livePreview = nil }
            return
        }
        guard let raw = try? await client.paneVisible(pane: pane.paneId, lines: 30) else { return }
        livePreview = LivePreviewExtractor.extract(raw)
    }

    /// Cache workspace labels so cross-workspace notifications from the in-thread
    /// poll read with the workspace name, not its id.
    private func refreshWorkspaceLabels() async {
        guard let workspaces = try? await client.workspaces() else { return }
        cachedLabels = Dictionary(
            workspaces.map { ($0.workspaceId, $0.label) },
            uniquingKeysWith: { first, _ in first }
        )
    }

    /// Refresh the header's model + context readout from the primary transcript.
    private func refreshSessionMeta() async {
        guard let pane = primaryPane, let path = tailedPaths[pane.cwd] else { return }
        if let meta = try? await store.sessionMeta(atPath: path), meta != sessionMeta {
            sessionMeta = meta
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
        guard let raw = try? await client.paneVisible(pane: pane.paneId, lines: 40) else { return }
        let parsed = BlockedPromptParser.parse(raw)
        blockedPrompt = parsed.isEmpty ? nil : parsed
    }

    /// Keep the tail set in sync with the workspace, per agent: retire tails that
    /// died or whose agent rotated to a new session, then make sure every
    /// conversation agent has one. An agent whose transcript file doesn't exist
    /// yet simply gets no task, so the next poll retries it — no whole-workspace
    /// teardown, which is what used to interrupt the healthy tails.
    private func reconcileTails() async {
        for cwd in deadTails { cancelTail(cwd: cwd) }
        for cwd in rotatedAgentCwds() { cancelTail(cwd: cwd) }
        await startTails()
    }

    /// Agents whose session id changed since we started following them — the
    /// authoritative rotation signal (a new Claude conversation = new transcript
    /// file). Agents without a session reference are re-resolved on tail death.
    private func rotatedAgentCwds() -> [String] {
        liveAgents.compactMap { agent in
            guard agent.agent != nil,
                  tailedPaths[agent.cwd] != nil,
                  agent.agentSession?.kind == "id",
                  let sid = agent.agentSession?.value,
                  let tailedSid = tailedSessions[agent.cwd],
                  tailedSid != sid
            else { return nil }
            return agent.cwd
        }
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
