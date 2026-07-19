import Foundation
import Observation
import HerdrKit

/// Drives one workspace thread: tails the transcript(s) of the agent(s) in the
/// workspace into chat bubbles, tracks live blocked/typing state, and sends
/// replies back through herdr.
@MainActor
@Observable
public final class ChatThreadViewModel {
    public let title: String
    public private(set) var messages: [ChatMessage] = []
    public private(set) var liveAgents: [AgentInfo]
    public var draft: String = ""
    public private(set) var error: String?
    public private(set) var isSending = false

    private let client: HerdrClient
    private let store: TranscriptStore
    private let workspaceId: String

    private var seenIDs = Set<String>()
    private var arrival: [ChatMessage] = []          // real transcript bubbles, in order
    private var localEchoes: [ChatMessage] = []      // optimistic user sends, pre-transcript
    private var tailTasks: [Task<Void, Never>] = []
    private var statusTask: Task<Void, Never>?

    public init(client: HerdrClient, summary: ChatSummary) {
        self.client = client
        self.store = TranscriptStore(transport: client.transport)
        self.title = summary.title
        self.workspaceId = summary.workspaceId
        self.liveAgents = summary.agents
        // Seed from the process cache so reopening a chat shows its history
        // instantly instead of re-reading the whole transcript.
        let cached = ThreadCache.shared.messages(summary.workspaceId)
        if !cached.isEmpty {
            arrival = cached
            seenIDs = ThreadCache.shared.seenIDs(summary.workspaceId)
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

    public func start() {
        startStatusPolling()
        Task { await startTails() }
    }

    public func stop() {
        tailTasks.forEach { $0.cancel() }
        tailTasks.removeAll()
        statusTask?.cancel()
        statusTask = nil
    }

    // MARK: - Reading

    /// Only bulk-load this many bytes of a fresh transcript up front; older
    /// history stays on disk. Keeps the first open fast even on huge sessions.
    private static let recentBytes = 400_000

    private func startTails() async {
        // One transcript tail per agent that owns a conversation.
        let agents = liveAgents.filter { $0.agent != nil }
        for agent in agents {
            guard let path = try? await store.newestTranscriptPath(forCwd: agent.cwd) else { continue }
            let label = agents.count > 1 ? agent.agent : nil
            let cachedBytes = ThreadCache.shared.bytes(workspaceId, path: path)
            let size = (try? await store.fileSize(atPath: path)) ?? -1
            let canResume = cachedBytes.map { size >= $0 } ?? false

            let followStart: Int
            if canResume {
                // Reopen: history already cached; just follow from where we left off.
                followStart = cachedBytes!
            } else {
                // First open: bulk-load only the recent slice in ONE read + ONE
                // batch (not line-by-line), then follow new appends live.
                ThreadCache.shared.resetBytes(workspaceId, path: path)
                if let recent = try? await store.recent(atPath: path, agentLabel: label, maxBytes: Self.recentBytes) {
                    ingestBatch(recent.messages)
                    ThreadCache.shared.setBytes(workspaceId, path: path, recent.consumedBytes)
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
                } catch {
                    await self?.setError(error)
                }
            }
            tailTasks.append(task)
        }
    }

    /// Ingest many messages with a single rebuild (used for the initial bulk load).
    private func ingestBatch(_ incoming: [ChatMessage]) {
        var added = false
        for message in incoming where !seenIDs.contains(message.id) {
            seenIDs.insert(message.id)
            ThreadCache.shared.add(workspaceId, message)
            arrival.append(message)
            added = true
        }
        if added { rebuild() }
    }

    private func ingestChunk(_ chunk: TailChunk, path: String) {
        if let message = chunk.message { ingest(message) }
        ThreadCache.shared.setBytes(workspaceId, path: path, chunk.consumedBytes)
    }

    private func ingest(_ message: ChatMessage) {
        guard !seenIDs.contains(message.id) else { return }
        seenIDs.insert(message.id)
        ThreadCache.shared.add(workspaceId, message)
        arrival.append(message)
        rebuild()
    }

    private func startStatusPolling() {
        statusTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                if let snapshot = try? await self.client.snapshot() {
                    self.liveAgents = snapshot.agents.filter { $0.workspaceId == self.workspaceId }
                }
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    private func rebuild() {
        // Drop optimistic echoes once the real user turn has landed.
        let realUserTexts = Set(arrival.filter { $0.role == .user }.map { $0.displayText.normalized })
        localEchoes.removeAll { realUserTexts.contains($0.displayText.normalized) }
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
        isSending = true
        // Optimistic echo so the bubble appears instantly.
        let echo = ChatMessage(
            id: "local-\(UUID().uuidString)",
            role: .user,
            segments: [.text(text)],
            timestamp: nil
        )
        localEchoes.append(echo)
        rebuild()
        do {
            try await client.sendMessage(toPane: pane.paneId, text: text)
        } catch {
            setError(error)
        }
        isSending = false
    }

    /// Quick reply to a blocked prompt (e.g. "Enter", "1", "Esc").
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
