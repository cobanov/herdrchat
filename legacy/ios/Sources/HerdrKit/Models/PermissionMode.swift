import Foundation

/// How much Claude asks before acting, chosen when a chat is started.
///
/// This matters more from a phone than from a desk: the default mode stops for
/// confirmation on essentially every tool call, and answering those one tap at a
/// time over SSH is the opposite of why you'd drive an agent from your pocket. So
/// new chats default to `bypass` — the mode you'd pick by hand anyway — while the
/// stricter modes stay one tap away.
public enum PermissionMode: String, Sendable, CaseIterable, Identifiable, Codable {
    /// Bypass all permission checks. Claude runs tools without asking.
    case bypass = "bypassPermissions"
    /// File edits are automatic; other tools still ask.
    case acceptEdits = "acceptEdits"
    /// Ask before acting — Claude Code's own default.
    case manual = "manual"
    /// Plan first, change nothing until you approve the plan.
    case plan = "plan"

    public var id: String { rawValue }

    /// The value passed to `claude --permission-mode`.
    public var flagValue: String { rawValue }

    public var title: String {
        switch self {
        case .bypass: return "Full access"
        case .acceptEdits: return "Auto-accept edits"
        case .manual: return "Ask every time"
        case .plan: return "Plan only"
        }
    }

    public var detail: String {
        switch self {
        case .bypass: return "Runs tools without asking. Best from a phone."
        case .acceptEdits: return "Edits apply automatically; other tools ask."
        case .manual: return "Confirms every tool call. Claude's default."
        case .plan: return "Proposes a plan and changes nothing until approved."
        }
    }

    public var symbol: String {
        switch self {
        case .bypass: return "bolt.fill"
        case .acceptEdits: return "pencil.circle"
        case .manual: return "hand.raised"
        case .plan: return "list.bullet.clipboard"
        }
    }

    /// The shell command that launches an agent in this mode.
    ///
    /// `manual` is spelled out rather than left implicit: the host's own settings
    /// may set a different default, and a chat started as "Ask every time" must
    /// actually ask.
    public func launchCommand(executable: String = "claude") -> String {
        "\(executable) --permission-mode \(flagValue)"
    }
}
