import Foundation

/// Semantic agent state as reported by herdr (socket API `AgentStatus`).
/// Unknown values decode to `.unknown` so a newer herdr can't break the app.
public enum AgentStatus: String, Codable, Sendable, CaseIterable {
    case idle
    case working
    case blocked
    case done
    case unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = AgentStatus(rawValue: raw) ?? .unknown
    }

    /// Whether this status needs the user's attention (drives the unread badge).
    public var needsAttention: Bool { self == .blocked }
}
