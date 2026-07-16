import Foundation

/// A single WhatsApp-style bubble derived from a Claude Code transcript turn.
/// One transcript entry (a user or assistant turn) maps to one ChatMessage; the
/// turn's parts become ordered `segments` so the UI can show text while
/// collapsing thinking and tool activity.
public struct ChatMessage: Sendable, Identifiable, Equatable {
    public enum Role: String, Sendable {
        case user
        case assistant
        case system
    }

    public let id: String
    public let role: Role
    public let segments: [MessageSegment]
    public let timestamp: Date?
    /// Which agent produced this (e.g. "claude"). Set when a workspace thread
    /// merges more than one agent so bubbles can be labelled.
    public let agentLabel: String?
    /// Sidechain = subagent chatter. Kept but flagged so the UI can hide it.
    public let isSidechain: Bool

    public init(
        id: String,
        role: Role,
        segments: [MessageSegment],
        timestamp: Date?,
        agentLabel: String? = nil,
        isSidechain: Bool = false
    ) {
        self.id = id
        self.role = role
        self.segments = segments
        self.timestamp = timestamp
        self.agentLabel = agentLabel
        self.isSidechain = isSidechain
    }

    /// The plain-text a chat bubble shows (text segments joined). Empty when the
    /// turn was pure thinking/tool activity.
    public var displayText: String {
        segments.compactMap { segment in
            if case let .text(value) = segment { return value }
            return nil
        }
        .joined(separator: "\n")
    }

    /// True when the turn carried no user-visible text (only thinking/tools).
    public var isToolOnly: Bool {
        displayText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

public enum MessageSegment: Sendable, Equatable {
    case text(String)
    case thinking(String)
    case toolUse(name: String, input: String?)
    case toolResult(String)
}
