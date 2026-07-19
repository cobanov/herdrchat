import Foundation
import Observation
import HerdrKit

/// Drives one workspace thread: tails the transcript(s) of the agent(s) in the
/// workspace into chat bubbles, tracks live blocked/typing state, and sends
/// replies back through herdr.
///
/// Lifecycle: owned by `ThreadSessions` (app-scoped), NOT by the view — so
/// navigating away keeps the tails alive and coming back is instant. The status
/// poll doubles as a health loop: it restarts dead tails after a connection
/// blip and follows transcript file rotation (new session files).
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

    private let client: HerdrClient
    private let store: TranscriptStore
    private let connectionID: String
    private let workspaceId: String

    private var seenIDs = Set<String>()
    private var arrival: [ChatMessage] = []          // real transcript bubbles, in order
    private var localEchoes: [ChatMessage] = []      // optimistic user sends, pre-transcript
    private var tailTasks: [Task<Void, Never>] = []
    private var tailedPaths: [String: String] = [:]  // agent cwd -> transcript path
    private var tailsDead = false
    private var statusTask: Task<Void, Never>?
    private var started = false

    /// Only bulk-load this many bytes of a fresh transcript up front; older
    /// history stays on disk. Keeps the first open fast even on huge sessions.
    private static let recentBytes = 400_000
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
        // Seed from the disk-backed cache so reopening (even after an app
        // restart) shows history instantly.
        let cached = ThreadCache.shared.messages(connectionID, summary.workspaceId)
        if !cached.isEmpty {
            arrival = cached
            seenIDs = ThreadCache.shared.seenIDs(connectionID, summary.workspaceId)
            messages = arrival
        }
    }

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
        statusTask?.cancel()
        statusTask = nil
        started = false
    }

    public func clearError() { error = nil }

    // MARK: - Reading

    private func startTails() async {
        // One transcript tail per agent that owns a conversation.
        let agents = liveAgents.filter { $0.agent != nil }
        for agent in agents {
            guard let path = try? await store.newestTranscriptPath(forCwd: agent.cwd) else { continue }
            let label = agents.count > 1 ? agent.agent : nil
            tailedPaths[agent.cwd] = path

            let cachedBytes = ThreadCache.shared.bytes(connectionID, workspaceId, path: path)
            let size = (try? await store.fileSize(atPath: path)) ?? -1
            let canResume = cachedBytes.map { size >= $0 } ?? false

            let followStart: Int
            if canResume {
                // Reopen: history cached; follow from just before where we left
                // off (rewind heals a mid-line cursor, dedupe eats the overlap).
                followStart = max(0, cachedBytes! - Self.resumeRewind)
            } else {
                // First open (or rotation): bulk-load only the recent slice in
                // ONE read + ONE batch, then follow new appends live.
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

    private func markTailsDead() {
        tailsDead = true
    }

    private func restartTails() async {
        tailTasks.forEach { $0.cancel() }
        tailTasks.removeAll()
        tailedPaths.removeAll()
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

    /// Status poll doubles as tail health/rotation watchdog.
    private func startStatusPolling() {
        statusTask = Task { [weak self] in
            var tick = 0
            while !Task.isCancelled {
                guard let self else { return }
                if let snapshot = try? await self.client.snapshot() {
                    self.liveAgents = snapshot.agents.filter { $0.workspaceId == self.workspaceId }
                    if self.error?.contains("host_key") != true { self.error = nil }
                    if self.tailsDead {
                        self.tailsDead = false
                        await self.restartTails()
                    } else if tick % 3 == 0, await self.rotationDetected() {
                        await self.restartTails()
                    }
                }
                tick += 1
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    /// True when any tailed agent's newest transcript is no longer the file we
    /// follow (Claude started a new session file).
    private func rotationDetected() async -> Bool {
        for (cwd, tailed) in tailedPaths {
            if let newest = try? await store.newestTranscriptPath(forCwd: cwd), newest != tailed {
                return true
            }
        }
        return false
    }

    private func rebuild() {
        // Drop optimistic echoes once the real user turn has landed.
        let realUserTexts = Set(arrival.filter { $0.role == .user }.map { $0.displayText.normalized })
        localEchoes.removeAll { echo in
            guard realUserTexts.contains(echo.displayText.normalized) else { return false }
            failedEchoIDs.remove(echo.id)
            return true
        }
        messages = arrival + localEchoes
    }

    private func setError(_ error: Error) {
        self.error = (error as? HerdrError)?.description ?? error.localizedDescription
    }

    // MARK: - Writing

    public func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let pane = primaryPane else { return }
        draft = ""
        // Optimistic echo so the bubble appears instantly.
        let echo = ChatMessage(
            id: "local-\(UUID().uuidString)",
            role: .user,
            segments: [.text(text)],
            timestamp: nil
        )
        localEchoes.append(echo)
        rebuild()
        await deliver(text: text, echoID: echo.id, paneId: pane.paneId)
    }

    /// Re-send a failed optimistic echo.
    public func retry(echoID: String) async {
        guard let echo = localEchoes.first(where: { $0.id == echoID }),
              let pane = primaryPane else { return }
        failedEchoIDs.remove(echoID)
        await deliver(text: echo.displayText, echoID: echoID, paneId: pane.paneId)
    }

    private func deliver(text: String, echoID: String, paneId: String) async {
        isSending = true
        do {
            try await client.sendMessage(toPane: paneId, text: text)
        } catch {
            failedEchoIDs.insert(echoID)
            setError(error)
        }
        isSending = false
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
