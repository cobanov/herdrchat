import Foundation

/// One selectable choice from a blocked agent prompt: the key(s) to send and the
/// human-readable label to show on the button.
public struct BlockedOption: Sendable, Equatable, Identifiable {
    public let number: Int          // 1-based menu index
    public let label: String        // e.g. "Yes, and don't ask again"
    public var id: Int { number }
    /// Keys to submit this choice: press the number, then Enter.
    public var keys: [String] { [String(number), "Enter"] }

    public init(number: Int, label: String) {
        self.number = number
        self.label = label
    }
}

/// A parsed "agent is waiting for input" prompt: the question plus its numbered
/// options, extracted from the pane's terminal buffer so the quick-reply bar can
/// show what each choice actually does instead of bare "1 / 2" chips.
public struct BlockedPrompt: Sendable, Equatable {
    public let question: String?
    public let options: [BlockedOption]

    public init(question: String?, options: [BlockedOption]) {
        self.question = question
        self.options = options
    }

    public var isEmpty: Bool { options.isEmpty }
}

public enum BlockedPromptParser {
    /// Parse the tail of an agent pane (a Claude Code choice prompt) into a
    /// question + numbered options. Returns a prompt with no options when the
    /// buffer doesn't hold a recognizable menu (the UI then falls back to its
    /// generic chips).
    public static func parse(_ raw: String) -> BlockedPrompt {
        let cleaned = raw
            .components(separatedBy: "\n")
            .map(clean)

        // Options: lines like "❯ 1. Yes" / "  2. No, tell Claude (esc)".
        var options: [BlockedOption] = []
        var firstOptionLine: Int?
        for (index, line) in cleaned.enumerated() {
            guard let option = option(from: line) else { continue }
            // Keep the last contiguous menu: a later menu supersedes an earlier
            // one still lingering in the scrollback.
            if let last = options.last, option.number <= last.number {
                options.removeAll()
                firstOptionLine = index
            }
            if firstOptionLine == nil { firstOptionLine = index }
            options.append(option)
        }

        guard !options.isEmpty, let firstLine = firstOptionLine else {
            return BlockedPrompt(question: nil, options: [])
        }

        // Question: the contiguous non-empty text lines immediately above the
        // first option (skip trailing blanks), oldest-first, joined.
        var questionLines: [String] = []
        var i = firstLine - 1
        // skip blank lines directly above the options
        while i >= 0, cleaned[i].isEmpty { i -= 1 }
        while i >= 0, !cleaned[i].isEmpty, option(from: cleaned[i]) == nil {
            questionLines.insert(cleaned[i], at: 0)
            i -= 1
        }
        let question = questionLines.joined(separator: " ").trimmingCharacters(in: .whitespaces)
        return BlockedPrompt(question: question.isEmpty ? nil : question, options: options)
    }

    /// Strip ANSI escapes and TUI box/border chrome, then trim.
    private static func clean(_ line: String) -> String {
        var s = line
        // ANSI CSI sequences (colours, cursor moves).
        while let range = s.range(of: "\u{1B}\\[[0-9;?]*[A-Za-z]", options: .regularExpression) {
            s.removeSubrange(range)
        }
        // Drop box-drawing borders and the leading gutter on both ends.
        let border = CharacterSet(charactersIn: "│┃|╭╮╰╯─┌┐└┘├┤ \t")
        s = s.trimmingCharacters(in: border)
        return s
    }

    /// Parse a single cleaned line as a menu option, e.g. "❯ 2. Yes, allow all".
    private static func option(from line: String) -> BlockedOption? {
        var s = line
        // Strip a leading selection marker.
        for marker in ["❯", "▶", ">", "→", "•", "*"] where s.hasPrefix(marker) {
            s = String(s.dropFirst(marker.count)).trimmingCharacters(in: .whitespaces)
            break
        }
        let digits = s.prefix(while: { $0.isNumber })
        guard !digits.isEmpty, let number = Int(digits) else { return nil }
        let after = s.dropFirst(digits.count)
        guard let punct = after.first, punct == "." || punct == ")" else { return nil }
        var label = String(after.dropFirst()).trimmingCharacters(in: .whitespaces)
        guard !label.isEmpty else { return nil }
        // Drop a trailing keyboard-hint like "(esc)".
        if let hint = label.range(of: "\\s*\\((esc|enter|return)\\)\\s*$", options: [.regularExpression, .caseInsensitive]) {
            label.removeSubrange(hint)
        }
        return BlockedOption(number: number, label: label.trimmingCharacters(in: .whitespaces))
    }
}
