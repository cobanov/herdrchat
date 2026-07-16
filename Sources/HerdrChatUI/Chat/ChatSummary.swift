import Foundation
import HerdrKit

/// One row in the chat list: a workspace, plus the agents running in it. This is
/// the "conversation" unit (workspace = chat).
public struct ChatSummary: Identifiable, Sendable, Hashable {
    public let workspaceId: String
    public let title: String
    public let number: Int
    public let status: AgentStatus
    public let agents: [AgentInfo]

    public var id: String { workspaceId }

    public var needsAttention: Bool { status.needsAttention }

    /// WhatsApp-style presence subtitle.
    public var subtitle: String {
        switch status {
        case .working: return "yazıyor…"
        case .blocked: return "seni bekliyor"
        case .done: return "bitti"
        case .idle: return agents.isEmpty ? "boşta" : "çevrimiçi"
        case .unknown: return agents.first?.agent ?? "—"
        }
    }

    /// The pane a message should be sent to: the focused agent, else the first.
    public var primaryPane: AgentInfo? {
        agents.first { $0.focused } ?? agents.first { $0.agent != nil } ?? agents.first
    }

    /// Build summaries by joining workspace rows with snapshot agents.
    public static func build(workspaces: [Workspace], agents: [AgentInfo]) -> [ChatSummary] {
        let byWorkspace = Dictionary(grouping: agents, by: \.workspaceId)
        return workspaces
            .sorted { $0.number < $1.number }
            .map { workspace in
                ChatSummary(
                    workspaceId: workspace.workspaceId,
                    title: workspace.label,
                    number: workspace.number,
                    status: workspace.agentStatus,
                    agents: byWorkspace[workspace.workspaceId] ?? []
                )
            }
    }
}
