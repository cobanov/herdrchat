import Foundation
import HerdrKit

/// The chat list's "last message" line, Messages-style: a one-glance snippet of
/// the newest transcript turn plus its timestamp.
public struct MessagePreview: Sendable, Hashable, Codable {
    public let text: String
    public let date: Date?
    public let fromUser: Bool

    public init(text: String, date: Date?, fromUser: Bool) {
        self.text = text
        self.date = date
        self.fromUser = fromUser
    }

    /// Collapse a transcript turn into a single-paragraph snippet, with the
    /// loudest Markdown tokens stripped so the list reads like plain prose.
    public init?(message: ChatMessage) {
        let collapsed = message.displayText
            .replacingOccurrences(of: "**", with: "")
            .replacingOccurrences(of: "__", with: "")
            .replacingOccurrences(of: "`", with: "")
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .map { $0.hasPrefix("#") ? String($0.drop(while: { $0 == "#" })) : $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        guard !collapsed.isEmpty else { return nil }
        self.init(
            text: String(collapsed.prefix(200)),
            date: message.timestamp,
            fromUser: message.role == .user
        )
    }
}

/// One row in the chat list: a workspace, plus the agents running in it. This is
/// the "conversation" unit (workspace = chat).
public struct ChatSummary: Identifiable, Sendable, Hashable {
    public let workspaceId: String
    public let title: String
    public let number: Int
    public let status: AgentStatus
    public let agents: [AgentInfo]
    /// Newest transcript message, for the Messages-style subtitle. Nil until the
    /// first preview fetch lands (or the workspace has no transcript yet).
    public let preview: MessagePreview?

    public var id: String { workspaceId }

    public var needsAttention: Bool { status.needsAttention }

    /// Presence fallback for rows with no preview yet.
    public var subtitle: String {
        switch status {
        case .working: return "working…"
        case .blocked: return "waiting for you"
        case .done: return "done"
        case .idle: return agents.isEmpty ? "idle" : "online"
        case .unknown: return agents.first?.agent ?? "—"
        }
    }

    /// The pane a message should be sent to: the focused agent, else the first.
    public var primaryPane: AgentInfo? {
        agents.first { $0.focused } ?? agents.first { $0.agent != nil } ?? agents.first
    }

    /// Build summaries by joining workspace rows with snapshot agents and the
    /// per-workspace last-message previews.
    public static func build(
        workspaces: [Workspace],
        agents: [AgentInfo],
        previews: [String: MessagePreview] = [:]
    ) -> [ChatSummary] {
        let byWorkspace = Dictionary(grouping: agents, by: \.workspaceId)
        return workspaces
            .sorted { $0.number < $1.number }
            .map { workspace in
                ChatSummary(
                    workspaceId: workspace.workspaceId,
                    title: workspace.label,
                    number: workspace.number,
                    status: workspace.agentStatus,
                    agents: byWorkspace[workspace.workspaceId] ?? [],
                    preview: previews[workspace.workspaceId]
                )
            }
    }
}
