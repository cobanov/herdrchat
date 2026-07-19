import Foundation
import Observation
import HerdrKit

/// Drives the chat list: polls the herdr host for workspaces + agent statuses
/// and publishes `ChatSummary` rows. Polling (vs the socket event stream) keeps
/// the SSH transport simple and is plenty responsive for a phone.
///
/// Each poll also refreshes the per-workspace "last message" previews in one
/// batched shell round-trip (see `TranscriptStore.latestMessages`), so rows read
/// like Messages: title + snippet + time. Previews persist across launches.
///
/// Also feeds `UnreadStore`: herdr's `done` means "finished but not looked at",
/// so a working→done/idle transition while the thread is off-screen marks the
/// workspace unread (the blue-dot moment in Messages).
@MainActor
@Observable
public final class WorkspacesViewModel {
    public private(set) var summaries: [ChatSummary] = []
    public private(set) var connectionError: String?
    public private(set) var isLoading = false

    private let client: HerdrClient
    private let store: TranscriptStore
    private let connectionID: String
    private let pollInterval: Duration
    private var pollTask: Task<Void, Never>?
    private var previousStatuses: [String: AgentStatus] = [:]
    private var previews: [String: MessagePreview] = [:]
    private var previewSessions: [String: String] = [:]   // workspaceId -> session signature
    private var previewTick = 0

    public init(client: HerdrClient, connectionID: String, pollInterval: Duration = .seconds(3)) {
        self.client = client
        self.store = TranscriptStore(transport: client.transport)
        self.connectionID = connectionID
        self.pollInterval = pollInterval
        self.previews = Self.loadPreviews(connectionID: connectionID)
        self.previewSessions = Self.loadPreviewSessions(connectionID: connectionID)
    }

    public func start() {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                await self.refresh()
                try? await Task.sleep(for: self.pollInterval)
            }
        }
    }

    public func stop() {
        pollTask?.cancel()
        pollTask = nil
    }

    /// The last working directory a workspace was created in (per connection),
    /// so the "new chat" sheet can prefill it — repeat use is one tap.
    public var lastCwd: String {
        get { UserDefaults.standard.string(forKey: "herdrchat.lastCwd.\(connectionID)") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "herdrchat.lastCwd.\(connectionID)") }
    }

    /// Distinct working directories already in use, offered as quick-fill
    /// suggestions in the new-chat sheet (start another agent in a known repo).
    public var knownCwds: [String] {
        var seen = Set<String>()
        var result: [String] = []
        for summary in summaries {
            for agent in summary.agents where agent.agent != nil {
                if seen.insert(agent.cwd).inserted { result.append(agent.cwd) }
            }
        }
        return result
    }

    /// Create a workspace at `cwd` and start `command` (Claude) in it. Returns the
    /// new workspace's summary once the list refresh sees it, so the caller can
    /// navigate straight into the fresh chat. Nil on failure (error is published).
    public func createWorkspace(cwd: String, label: String?, command: String = "claude") async -> ChatSummary? {
        let trimmedCwd = cwd.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedCwd.isEmpty else { return nil }
        do {
            let creation = try await client.createWorkspace(cwd: trimmedCwd, label: label?.trimmingCharacters(in: .whitespacesAndNewlines))
            try await client.startAgent(inPane: creation.rootPane.paneId, command: command)
            lastCwd = trimmedCwd
            await refresh()
            return summaries.first { $0.workspaceId == creation.workspace.workspaceId }
        } catch {
            connectionError = (error as? HerdrError)?.description ?? error.localizedDescription
            return nil
        }
    }

    /// Host home directory for the folder picker's starting point (falls back to
    /// root if the host can't be reached).
    public func homeDirectory() async -> String {
        (try? await client.homeDirectory()) ?? "/"
    }

    /// Immediate subdirectories of `path` on the host, for the folder picker.
    /// Best-effort: an unreachable host or unreadable path yields an empty list.
    public func listDirectories(at path: String) async -> [String] {
        (try? await client.listDirectories(at: path)) ?? []
    }

    public func refresh() async {
        if summaries.isEmpty { isLoading = true }
        do {
            async let workspacesFetch = client.workspaces()
            async let snapshotFetch = client.snapshot()
            let workspaces = try await workspacesFetch
            let agents = try await snapshotFetch.agents
            invalidateStalePreviews(agents: agents)
            await refreshPreviews(agents: agents)
            let rows = ChatSummary.build(workspaces: workspaces, agents: agents, previews: previews)
            markUnreadTransitions(rows)
            summaries = rows
            connectionError = nil
            // Keep the notification baseline fresh: states the user is looking
            // at right now shouldn't re-notify from the background task later.
            AgentNotifier.record(agents)
        } catch {
            connectionError = (error as? HerdrError)?.description ?? error.localizedDescription
        }
        isLoading = false
    }

    /// Refresh the last-message previews (one batched round-trip). Active or
    /// preview-less workspaces refresh every poll; everything else joins a full
    /// sweep every 5th poll, so steady-state traffic stays tiny. Best-effort:
    /// a failed fetch keeps the previous snippets rather than erroring the list.
    private func refreshPreviews(agents: [AgentInfo]) async {
        previewTick += 1
        let fullSweep = previewTick % 5 == 1   // includes the very first poll
        let byWorkspace = Dictionary(grouping: agents.filter { $0.agent != nil }, by: \.workspaceId)
        let requests = byWorkspace.compactMap { workspaceId, agents -> TranscriptStore.PreviewRequest? in
            // A chat's identity is its Claude session, not its workspace slot. Until
            // the agent reports a concrete session id we can't tell a new chat's
            // transcript from the previous one's under the same project dir — so we
            // NEVER fall back to the newest `.jsonl` here (that guess previews a
            // foreign session's last message under a reused or same-named workspace,
            // the reported bug). Prefer the focused agent, but only one that actually
            // has a session id; skip the row until a session is known (the row then
            // shows its live status line, not a stale preview).
            guard let agent = agents.first(where: { $0.focused && $0.hasSessionId })
                    ?? agents.first(where: { $0.hasSessionId }),
                  let sessionId = agent.agentSession?.value else { return nil }
            let active = agents.contains { $0.agentStatus != .idle && $0.agentStatus != .unknown }
            guard fullSweep || active || previews[workspaceId] == nil else { return nil }
            return TranscriptStore.PreviewRequest(workspaceId: workspaceId, cwd: agent.cwd, sessionId: sessionId)
        }
        guard !requests.isEmpty,
              let latest = try? await store.latestMessages(for: requests) else { return }
        var changed = false
        for (workspaceId, message) in latest {
            guard let preview = MessagePreview(message: message), previews[workspaceId] != preview else { continue }
            previews[workspaceId] = preview
            changed = true
        }
        if changed { persistPreviews() }
    }

    /// Drop a workspace's cached last-message when its session changed, so the
    /// list never previews a previous chat's line under a reused workspace (same
    /// bug as the thread view: identity is the session, not the workspace slot).
    private func invalidateStalePreviews(agents: [AgentInfo]) {
        let byWorkspace = Dictionary(grouping: agents.filter { $0.agent != nil }, by: \.workspaceId)
        var droppedPreview = false
        var changedSessions = false
        for (workspaceId, group) in byWorkspace {
            guard let sig = group.sessionSignature else { continue }
            if let previous = previewSessions[workspaceId], previous != sig {
                previews[workspaceId] = nil
                droppedPreview = true
            }
            if previewSessions[workspaceId] != sig {
                previewSessions[workspaceId] = sig
                changedSessions = true
            }
        }
        if droppedPreview { persistPreviews() }
        // Persisted so the drop also fires across launches: if a workspace was
        // reused by a new chat while the app was closed, the stale preview loaded
        // from disk is cleared on the first refresh instead of lingering.
        if changedSessions { persistPreviewSessions() }
    }

    /// working → done/idle while the thread is off-screen = unread.
    private func markUnreadTransitions(_ rows: [ChatSummary]) {
        for row in rows {
            let previous = previousStatuses[row.workspaceId]
            if previous == .working, row.status == .done || row.status == .idle {
                UnreadStore.shared.mark(UnreadStore.key(connectionID, row.workspaceId))
            }
            previousStatuses[row.workspaceId] = row.status
        }
    }

    /// Total workspaces currently needing attention (blocked), for the badge.
    public var attentionCount: Int {
        summaries.filter(\.needsAttention).count
    }

    // MARK: - Preview persistence (so rows read right on launch, pre-connect)

    private var previewsKey: String { "herdrchat.previews.\(connectionID)" }

    private static func loadPreviews(connectionID: String) -> [String: MessagePreview] {
        guard let data = UserDefaults.standard.data(forKey: "herdrchat.previews.\(connectionID)"),
              let stored = try? JSONDecoder().decode([String: MessagePreview].self, from: data) else { return [:] }
        return stored
    }

    private func persistPreviews() {
        if let data = try? JSONEncoder().encode(previews) {
            UserDefaults.standard.set(data, forKey: previewsKey)
        }
    }

    private var previewSessionsKey: String { "herdrchat.previewSessions.\(connectionID)" }

    private static func loadPreviewSessions(connectionID: String) -> [String: String] {
        guard let data = UserDefaults.standard.data(forKey: "herdrchat.previewSessions.\(connectionID)"),
              let stored = try? JSONDecoder().decode([String: String].self, from: data) else { return [:] }
        return stored
    }

    private func persistPreviewSessions() {
        if let data = try? JSONEncoder().encode(previewSessions) {
            UserDefaults.standard.set(data, forKey: previewSessionsKey)
        }
    }
}
