import Foundation

/// One agent-bearing pane, as returned by `agent.list` / inside `session.snapshot`.
public struct AgentInfo: Decodable, Sendable, Identifiable, Equatable {
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

    public var id: String { paneId }
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
