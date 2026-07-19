import Foundation

/// One agent-bearing pane, as returned by `agent.list` / inside `session.snapshot`.
public struct AgentInfo: Decodable, Sendable, Identifiable, Hashable {
    public let agent: String?          // detected agent label, e.g. "claude"; nil for plain panes
    public let agentStatus: AgentStatus
    public let cwd: String
    public let foregroundCwd: String?
    public let focused: Bool
    public let paneId: String
    public let tabId: String
    public let terminalId: String?
    public let workspaceId: String
    public let revision: Int?
    /// Native session reference reported by the agent integration. For Claude
    /// Code, `value` (kind == "id") is the session UUID — i.e. the exact
    /// transcript filename — so transcripts can be targeted precisely instead
    /// of guessing "newest .jsonl in the project dir".
    public let agentSession: AgentSessionRef?

    public var id: String { paneId }
}

/// `agent_session` payload: how an integration identifies its native session.
public struct AgentSessionRef: Decodable, Sendable, Hashable {
    public let agent: String?
    public let kind: String?       // "id" | "path" | ...
    public let source: String?
    public let value: String?
}

public extension Array where Element == AgentInfo {
    /// Stable identity of the conversation(s) these agents host: the sorted,
    /// joined Claude session ids. A chat's identity is its session, not its
    /// workspace slot — this is what distinguishes a new chat from the one that
    /// used the workspace before it. Nil when no agent reports a session id yet.
    var sessionSignature: String? {
        let ids = compactMap { agent -> String? in
            guard agent.agent != nil, agent.agentSession?.kind == "id",
                  let value = agent.agentSession?.value, !value.isEmpty else { return nil }
            return value
        }
        guard !ids.isEmpty else { return nil }
        return Set(ids).sorted().joined(separator: ",")
    }
}

/// A workspace row, as returned by `workspace.list`.
public struct Workspace: Decodable, Sendable, Identifiable, Equatable {
    public let workspaceId: String
    public let label: String
    public let number: Int
    public let agentStatus: AgentStatus
    public let focused: Bool
    public let activeTabId: String?
    public let paneCount: Int
    public let tabCount: Int

    public var id: String { workspaceId }
}

/// A pane row, as returned by `pane.list`.
public struct Pane: Decodable, Sendable, Identifiable, Equatable {
    public let paneId: String
    public let workspaceId: String
    public let tabId: String
    public let terminalId: String?
    public let agent: String?
    public let agentStatus: AgentStatus
    public let cwd: String
    public let foregroundCwd: String?
    public let focused: Bool

    public var id: String { paneId }
}

/// Full runtime snapshot (`session.snapshot`). Layout geometry is decoded but
/// optional so the app tolerates herdr shape changes.
public struct Snapshot: Decodable, Sendable, Equatable {
    public let agents: [AgentInfo]
    public let focusedPaneId: String?
    public let focusedTabId: String?
    public let focusedWorkspaceId: String?
    public let layouts: [TabLayout]?
}

public struct TabLayout: Decodable, Sendable, Equatable {
    public let workspaceId: String
    public let tabId: String
    public let focusedPaneId: String?
    public let zoomed: Bool
    public let panes: [PaneBox]
    public let splits: [SplitInfo]
}

public struct PaneBox: Decodable, Sendable, Equatable {
    public let paneId: String
    public let focused: Bool
    public let rect: Rect
}

public struct SplitInfo: Decodable, Sendable, Equatable {
    public let id: String
    public let direction: SplitDirection
    public let ratio: Double
    public let rect: Rect
}

public struct Rect: Decodable, Sendable, Equatable {
    public let x: Int
    public let y: Int
    public let width: Int
    public let height: Int
}

// MARK: - CLI/socket result envelopes

public struct SnapshotResult: Decodable, Sendable { public let snapshot: Snapshot }
public struct WorkspaceListResult: Decodable, Sendable { public let workspaces: [Workspace] }
public struct AgentListResult: Decodable, Sendable { public let agents: [AgentInfo] }
public struct PaneListResult: Decodable, Sendable { public let panes: [Pane] }
