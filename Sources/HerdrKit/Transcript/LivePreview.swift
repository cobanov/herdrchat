import Foundation

/// Best-effort extraction of an agent's in-progress answer from the pane's
/// VISIBLE screen, for a live "streaming" preview bubble while the turn is still
/// being written (transcripts are only turn-granular). Mirrors cmux's
/// spinner-anchor heuristic: find the status/spinner line, take the prose block
/// above it, and drop all TUI chrome. Returns nil unless it finds real prose, so
/// the caller can fall back to a plain waiting bar rather than show noise.
public enum LivePreviewExtractor {
    public static func extract(_ raw: String) -> String? {
        let lines = raw.components(separatedBy: "\n").map(clean)

        // Anchor: the last status/spinner line (Claude prints one while working).
        let anchor = lines.lastIndex(where: isStatusLine)
        // Otherwise stop at the composer input line near the bottom.
        let end = anchor ?? lines.lastIndex(where: { $0.hasPrefix("❯") }) ?? lines.count

        var collected: [String] = []
        var i = end - 1
        while i >= 0 && collected.count < 8 {
            let line = lines[i]
            if line.isEmpty { if collected.isEmpty { i -= 1; continue } else { break } }
            if isChrome(line) { i -= 1; continue }
            collected.insert(line, at: 0)
            i -= 1
        }
        var text = collected.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        // Drop a leading answer bullet ("⏺ ").
        for bullet in ["⏺", "●", "⏵"] where text.hasPrefix(bullet) {
            text = String(text.dropFirst(bullet.count)).trimmingCharacters(in: .whitespaces)
            break
        }
        return text.count >= 20 ? text : nil   // require real prose, else nil
    }

    private static func clean(_ line: String) -> String {
        var s = line
        while let r = s.range(of: "\u{1B}\\[[0-9;?]*[A-Za-z]", options: .regularExpression) {
            s.removeSubrange(r)
        }
        return s.trimmingCharacters(in: CharacterSet(charactersIn: "│┃|╭╮╰╯─┌┐└┘├┤ \t"))
    }

    /// Claude's working status line: a spinner glyph, a token counter, or an
    /// "esc to interrupt" hint.
    private static func isStatusLine(_ s: String) -> Bool {
        if s.isEmpty { return false }
        if "✳✽✻✢✶✷✸✹✺⚹∗·".contains(where: { s.contains($0) }) { return true }
        let l = s.lowercased()
        return l.contains("esc to interrupt") || l.contains("tokens)") || l.contains("token · ")
            || l.contains("↓ ") && l.contains("token")
    }

    /// TUI chrome that isn't the agent's answer: the composer, rules, the shell
    /// prompt / herdr footer, mode hints.
    private static func isChrome(_ s: String) -> Bool {
        if s.hasPrefix("❯") || s.hasPrefix(">") { return true }
        if s.allSatisfy({ $0 == "-" || $0 == "─" || $0 == "=" }) { return true }
        let l = s.lowercased()
        return l.contains("manual mode") || l.contains("for agents") || l.contains("/effort")
            || l.contains("◉") || l.contains("esc to") || l.contains("ctrl+") || l.contains("⏸")
            || l.contains("resume this session") || l.contains("? for shortcuts")
            || (s.contains("|") && s.contains("@") && (s.contains("~") || s.contains("/")))   // shell prompt
    }
}
