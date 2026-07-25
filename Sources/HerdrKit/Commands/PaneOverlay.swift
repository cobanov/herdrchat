import Foundation

/// A keyboard affordance a Claude Code overlay advertises in its footer, e.g.
/// "s to use this session only" or "Esc to cancel". Claude spells these out on
/// screen, so they are read rather than guessed.
public struct OverlayAction: Sendable, Equatable, Identifiable {
    /// Key label as shown ("Enter", "Esc", "s").
    public let key: String
    /// What it does ("set as default", "use this session only", "cancel").
    public let detail: String
    /// Token(s) for `pane send-keys`.
    public let keys: [String]

    public var id: String { "\(key)|\(detail)" }

    public init(key: String, detail: String, keys: [String]) {
        self.key = key
        self.detail = detail
        self.keys = keys
    }
}

/// What kind of interactive surface is on screen. Both shapes were observed on a
/// live pane, and they need different UI: one can be answered with buttons, the
/// other can only be driven.
public enum PaneOverlayKind: Sendable, Equatable {
    /// A numbered menu — `/model`, permission prompts. Answerable by tapping a row.
    case menu(BlockedPrompt)
    /// An overlay with no numbered rows: `/resume` is a search box over a list,
    /// driven by typing plus arrows. There are no rows to turn into buttons, so
    /// the app shows the screen itself and a keypad instead of pretending
    /// otherwise. Without this, every such command would be a dead end.
    case raw(screen: String, title: String?)
}

/// An interactive surface currently drawn over an agent pane.
///
/// This exists because of a measured fact: when a slash command like `/model`
/// opens its picker, herdr still reports the agent as `idle`, NOT `blocked`. So
/// the blocked-status path can't see these at all — they have to be spotted on
/// the screen itself.
public struct PaneOverlay: Sendable, Equatable {
    public let kind: PaneOverlayKind
    /// Extra keys the footer offered, beyond picking a numbered option.
    public let actions: [OverlayAction]

    public init(kind: PaneOverlayKind, actions: [OverlayAction]) {
        self.kind = kind
        self.actions = actions
    }

    /// The numbered menu, when this overlay is one.
    public var prompt: BlockedPrompt? {
        guard case .menu(let prompt) = kind else { return nil }
        return prompt
    }

    public var isRaw: Bool {
        if case .raw = kind { return true }
        return false
    }
}

public enum PaneOverlayDetector {
    /// How far up from the bottom of the screen a real overlay can start. Menus
    /// are anchored just above the composer; a numbered list further up is
    /// transcript prose that happens to look like one.
    private static let overlayWindow = 30

    /// Look for an interactive surface in a pane's VISIBLE screen.
    ///
    /// The gate is the FOOTER, not the menu: nothing is reported unless the screen
    /// advertises keyboard affordances ("Enter to confirm · Esc to cancel"). That
    /// is what keeps ordinary content out — an agent answering with a numbered
    /// list is routine, but only a real overlay tells you which keys it takes.
    /// Requiring that corroboration is the difference between a detector and a
    /// guess.
    ///
    /// With the footer present, a numbered menu becomes `.menu`; anything else
    /// becomes `.raw` so it can still be driven rather than being a dead end.
    public static func detect(_ raw: String) -> PaneOverlay? {
        let lines = raw.components(separatedBy: "\n")
        guard let footer = footerLine(in: lines) else { return nil }
        let actions = actions(from: footer)

        let region = overlayRegion(lines)
        let prompt = BlockedPromptParser.parse(region.joined(separator: "\n"))
        // One "option" is far too weak a signal to treat as a menu.
        if prompt.options.count >= 2 {
            return PaneOverlay(kind: .menu(prompt), actions: actions)
        }

        // No rows to tap: hand back the screen so the UI can show it verbatim.
        let body = region
            .map(strip)
            .drop { $0.isEmpty }
            .reversed().drop { $0.isEmpty }.reversed()
        let screen = body.joined(separator: "\n")
        guard !screen.isEmpty else { return nil }
        return PaneOverlay(
            kind: .raw(screen: screen, title: body.first { !$0.isEmpty }),
            actions: actions
        )
    }

    /// The overlay's own region of the screen. Claude draws a `▔▔▔` rule directly
    /// above an overlay — observed on both `/model` and `/resume` — so that rule
    /// bounds it exactly. Falling back to a fixed number of trailing lines would
    /// otherwise drag conversation text into the card.
    private static func overlayRegion(_ lines: [String]) -> [String] {
        if let index = lines.lastIndex(where: isTopRule) {
            return Array(lines[(index + 1)...])
        }
        return Array(lines.suffix(overlayWindow))
    }

    private static func isTopRule(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 8 else { return false }
        return trimmed.allSatisfy { $0 == "▔" }
    }

    /// The last non-empty line that reads like a hint footer. Claude draws it
    /// under the menu, above the input box.
    private static func footerLine(in lines: [String]) -> String? {
        for line in lines.suffix(overlayWindow).reversed() {
            let cleaned = strip(line)
            guard !cleaned.isEmpty else { continue }
            if isAffordanceFooter(cleaned) { return cleaned }
        }
        return nil
    }

    /// Does this line advertise keyboard affordances? Matches the shapes Claude
    /// Code actually prints: "Enter to confirm · Esc to cancel",
    /// "Enter to set as default · s to use this session only · Esc to cancel",
    /// "↑/↓ to select".
    static func isAffordanceFooter(_ line: String) -> Bool {
        let pattern = "(?i)\\b(enter|esc|escape|return|tab|space|↑|↓|←|→)\\b[^·]{0,40}?\\bto\\b"
        return line.range(of: pattern, options: .regularExpression) != nil
    }

    /// Split a footer into its individual affordances. Segments are separated by
    /// "·" and each reads "<key> to <what it does>".
    static func actions(from footer: String) -> [OverlayAction] {
        footer
            .components(separatedBy: "·")
            .compactMap { action(from: $0.trimmingCharacters(in: .whitespaces)) }
    }

    private static func action(from segment: String) -> OverlayAction? {
        guard let range = segment.range(of: " to ", options: .caseInsensitive) else { return nil }
        let key = String(segment[segment.startIndex..<range.lowerBound])
            .trimmingCharacters(in: .whitespaces)
        let detail = String(segment[range.upperBound...]).trimmingCharacters(in: .whitespaces)
        guard !key.isEmpty, !detail.isEmpty, let keys = sendKeys(for: key) else { return nil }
        return OverlayAction(key: key, detail: detail, keys: keys)
    }

    /// Map a footer's key label onto `pane send-keys` tokens. Returns nil for
    /// anything we can't send faithfully — "↑/↓", "Type to search" — so the UI
    /// never offers a button that would do nothing.
    static func sendKeys(for label: String) -> [String]? {
        let lower = label.lowercased()
        switch lower {
        case "enter", "return": return ["Enter"]
        case "esc", "escape": return ["Escape"]
        case "tab": return ["Tab"]
        case "space": return ["Space"]
        default: break
        }
        // Control chords, which `/resume` advertises as "Ctrl+A to show all
        // projects". herdr wants `ctrl+<letter>`; it rejects the tmux-style `C-a`
        // outright with `unsupported key` — verified against a live pane, which is
        // the only reason this isn't shipped as a button that errors on tap.
        for prefix in ["ctrl+", "ctrl-", "^"] where lower.hasPrefix(prefix) {
            let rest = lower.dropFirst(prefix.count)
            guard rest.count == 1, let character = rest.first, character.isLetter else { return nil }
            return ["ctrl+\(character)"]
        }
        // A bare letter shortcut, e.g. "s to use this session only".
        guard label.count == 1, let character = label.first, character.isLetter else { return nil }
        return [String(character)]
    }

    /// The keys every driven overlay accepts whether or not its footer spells them
    /// out: move the selection, confirm, cancel. `/resume` documents Ctrl chords
    /// and "Type to search" but never mentions the arrows it is navigated with.
    public static let navigationActions: [OverlayAction] = [
        OverlayAction(key: "↑", detail: "up", keys: ["Up"]),
        OverlayAction(key: "↓", detail: "down", keys: ["Down"]),
        OverlayAction(key: "Enter", detail: "select", keys: ["Enter"]),
        OverlayAction(key: "Esc", detail: "cancel", keys: ["Escape"]),
    ]

    /// Strip ANSI escapes and TUI border chrome from one line.
    private static func strip(_ line: String) -> String {
        var s = line
        while let range = s.range(of: "\u{1B}\\[[0-9;?]*[A-Za-z]", options: .regularExpression) {
            s.removeSubrange(range)
        }
        let border = CharacterSet(charactersIn: "│┃|╭╮╰╯─━▔┌┐└┘├┤ \t")
        return s.trimmingCharacters(in: border)
    }
}
