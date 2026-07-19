import Foundation
import Observation
import HerdrKit

/// Drives the chat list: polls the herdr host for workspaces + agent statuses
/// and publishes `ChatSummary` rows. Polling (vs the socket event stream) keeps
/// the SSH transport simple and is plenty responsive for a phone.
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
    private let connectionID: String
    private let pollInterval: Duration
    private var pollTask: Task<Void, Never>?
    private var previousStatuses: [String: AgentStatus] = [:]

    public init(client: HerdrClient, connectionID: String, pollInterval: Duration = .seconds(3)) {
        self.client = client
        self.connectionID = connectionID
        self.pollInterval = pollInterval
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

    public func refresh() async {
        if summaries.isEmpty { isLoading = true }
        do {
            async let workspaces = client.workspaces()
            async let snapshot = client.snapshot()
            let rows = try await ChatSummary.build(workspaces: workspaces, agents: snapshot.agents)
            markUnreadTransitions(rows)
            summaries = rows
            connectionError = nil
            // Keep the notification baseline fresh: states the user is looking
            // at right now shouldn't re-notify from the background task later.
            AgentNotifier.record(try await snapshot.agents)
        } catch {
            connectionError = (error as? HerdrError)?.description ?? error.localizedDescription
        }
        isLoading = false
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
}
