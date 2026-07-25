import Foundation

/// A slash command that can be invoked in an agent pane, as shown in the app's
/// command palette.
///
/// The palette is a DISCOVERY aid, not the boundary of what you can run: the
/// composer always accepts free text, so any command — including one this list
/// doesn't know about — can still be typed and sent by hand. That is why an
/// incomplete built-in list is a cosmetic gap rather than a functional limit.
public struct SlashCommand: Sendable, Equatable, Hashable, Identifiable {
    public enum Source: String, Sendable, Equatable, Hashable {
        /// Shipped by Claude Code itself.
        case builtIn
        /// `~/.claude/commands/*.md`
        case userCommand
        /// `<cwd>/.claude/commands/*.md`
        case projectCommand
        /// `~/.claude/skills/*/SKILL.md`
        case userSkill
        /// `<cwd>/.claude/skills/*/SKILL.md`
        case projectSkill
        /// Provided by an installed plugin, namespaced `<plugin>:<name>`.
        case plugin

        /// Short badge for the palette row.
        public var badge: String {
            switch self {
            case .builtIn: return "built-in"
            case .userCommand: return "user"
            case .projectCommand: return "project"
            case .userSkill: return "skill"
            case .projectSkill: return "project skill"
            case .plugin: return "plugin"
            }
        }
    }

    /// Command name without the leading slash.
    public let name: String
    /// One-line description, when the source provides one.
    public let summary: String?
    public let source: Source

    public var id: String { "\(source.rawValue):\(name)" }
    /// What gets typed into the pane.
    public var invocation: String { "/\(name)" }

    public init(name: String, summary: String?, source: Source) {
        self.name = name
        self.summary = summary
        self.source = source
    }

    /// Does this command match what the user has typed after the slash?
    /// Prefix matches rank above interior matches; see `rank(for:)`.
    public func matches(_ query: String) -> Bool {
        query.isEmpty || name.lowercased().contains(query.lowercased())
    }

    /// Lower sorts first: exact, then prefix, then interior match.
    public func rank(for query: String) -> Int {
        guard !query.isEmpty else { return 1 }
        let name = self.name.lowercased(), query = query.lowercased()
        if name == query { return 0 }
        if name.hasPrefix(query) { return 1 }
        return 2
    }
}

public extension SlashCommand {
    /// Claude Code's own commands, curated. Deliberately conservative — it lists
    /// the long-stable ones worth one-tap access, not every command in every
    /// version. An unknown command is a soft failure (Claude Code answers
    /// "unknown command" in the pane), and anything missing here can still be
    /// typed by hand, so being incomplete costs discoverability, not capability.
    static let builtIns: [SlashCommand] = [
        ("model", "Switch between Claude models"),
        ("effort", "Set reasoning effort for this session"),
        ("clear", "Start a fresh conversation — clears history"),
        ("compact", "Summarise the conversation to free up context"),
        ("context", "Show what is currently filling the context window"),
        ("cost", "Show token usage and cost for this session"),
        ("usage", "Show plan usage and limits"),
        ("resume", "Reopen an earlier conversation"),
        ("rewind", "Roll the conversation back to an earlier point"),
        // No /agents: its wizard was removed in Claude Code 2.1 and the command
        // now only prints a note pointing at the docs. Verified on a live pane —
        // a palette row whose only outcome is "this was removed" is noise.
        ("todos", "Show the current task list"),
        ("memory", "Edit CLAUDE.md memory files"),
        ("init", "Create a CLAUDE.md for this project"),
        ("review", "Review a pull request"),
        ("permissions", "View and edit tool permissions"),
        ("hooks", "Configure hooks"),
        ("mcp", "Manage MCP servers"),
        ("config", "Open settings"),
        ("status", "Show version, account and connection status"),
        ("doctor", "Diagnose the installation"),
        ("export", "Export this conversation"),
        ("add-dir", "Give Claude access to another directory"),
        ("output-style", "Change the output style"),
        ("statusline", "Configure the status line"),
        ("release-notes", "What changed in recent versions"),
        ("help", "List available commands"),
        ("bug", "Report a bug to Anthropic"),
    ].map { SlashCommand(name: $0.0, summary: $0.1, source: .builtIn) }
}
