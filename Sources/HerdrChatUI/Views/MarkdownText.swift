import SwiftUI

/// Lightweight, native block-level Markdown renderer for chat bubbles. Handles
/// what Claude actually emits — fenced code blocks, headings, bullet/numbered
/// lists, blockquotes, rules, and inline **bold** / *italic* / `code` / [links]
/// — using system type so it reads like first-party text. Inline styling comes
/// from `AttributedString`; block layout is done here because a single
/// AttributedString can't lay out code blocks or lists on their own rows.
struct MarkdownText: View {
    let markdown: String
    var foreground: Color = .primary
    /// True on the outgoing (tinted) bubble, so code fills read light-on-tint.
    var onTint: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(MarkdownBlock.parse(markdown).enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
    }

    @ViewBuilder
    private func blockView(_ block: MarkdownBlock) -> some View {
        switch block {
        case .paragraph(let text):
            Text(inline(text))
        case .heading(let level, let text):
            Text(inline(text)).font(headingFont(level)).fontWeight(.semibold)
        case .bullet(let items):
            VStack(alignment: .leading, spacing: 3) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    listRow(marker: "•", item)
                }
            }
        case .numbered(let items):
            VStack(alignment: .leading, spacing: 3) {
                ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                    listRow(marker: "\(i + 1).", item)
                }
            }
        case .quote(let text):
            HStack(alignment: .top, spacing: 8) {
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(foreground.opacity(0.35))
                    .frame(width: 3)
                Text(inline(text)).italic().opacity(0.9)
            }
        case .code(let language, let content):
            codeBlock(language: language, content: content)
        case .table(let headers, let rows):
            tableBlockView(headers: headers, rows: rows)
        case .rule:
            Rectangle().fill(foreground.opacity(0.18)).frame(height: 1).padding(.vertical, 2)
        }
    }

    /// GFM table: a horizontally-scrollable grid with a bold header row and
    /// hairline separators. Columns size to content within sensible bounds so a
    /// wide table scrolls instead of squeezing the bubble.
    private func tableBlockView(headers: [String], rows: [[String]]) -> some View {
        let columns = max(headers.count, rows.map(\.count).max() ?? 0)
        return ScrollView(.horizontal, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                tableRowView(headers, columns: columns, header: true)
                Rectangle().fill(foreground.opacity(0.25)).frame(height: 1)
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    tableRowView(row, columns: columns, header: false)
                    if index < rows.count - 1 {
                        Rectangle().fill(foreground.opacity(0.12)).frame(height: 1)
                    }
                }
            }
            .padding(8)
        }
        .background(onTint ? Color.white.opacity(0.12) : Theme.fillSubtle)
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .strokeBorder(foreground.opacity(0.12), lineWidth: 1)
        )
    }

    private func tableRowView(_ cells: [String], columns: Int, header: Bool) -> some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(0..<columns, id: \.self) { c in
                Text(inline(c < cells.count ? cells[c] : ""))
                    .font(header ? .footnote.weight(.semibold) : .footnote)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(minWidth: 56, maxWidth: 220, alignment: .leading)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                if c < columns - 1 {
                    Rectangle().fill(foreground.opacity(0.1)).frame(width: 1)
                }
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private func listRow(marker: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text(marker).monospacedDigit().foregroundStyle(foreground.opacity(0.7))
            Text(inline(text))
        }
    }

    private func codeBlock(language: String?, content: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let language, !language.isEmpty {
                Text(language.lowercased())
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                Text(content)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(foreground)
                    .textSelection(.enabled)
            }
        }
        .padding(9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(onTint ? Color.white.opacity(0.18) : Theme.fillSubtle)
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: return .title3
        case 2: return .headline
        default: return .subheadline
        }
    }

    /// Inline markdown → styled AttributedString. Inline code becomes monospaced
    /// with a subtle fill; links keep the tint (foreground applied elsewhere).
    private func inline(_ string: String) -> AttributedString {
        var options = AttributedString.MarkdownParsingOptions()
        options.interpretedSyntax = .inlineOnlyPreservingWhitespace
        options.failurePolicy = .returnPartiallyParsedIfPossible
        guard var attr = try? AttributedString(markdown: string, options: options) else {
            var plain = AttributedString(string)
            plain.foregroundColor = foreground
            return plain
        }
        for run in attr.runs {
            if run.link == nil {
                attr[run.range].foregroundColor = foreground
            }
            if run.inlinePresentationIntent?.contains(.code) == true {
                attr[run.range].font = .system(.body, design: .monospaced)
                attr[run.range].backgroundColor = onTint ? Color.white.opacity(0.22) : Theme.fillSubtle
            }
        }
        return attr
    }
}

/// A parsed Markdown block. Line-based parsing covers the constructs Claude
/// produces in practice; unknown syntax falls through to paragraphs.
enum MarkdownBlock {
    case paragraph(String)
    case heading(Int, String)
    case bullet([String])
    case numbered([String])
    case quote(String)
    case code(language: String?, content: String)
    case table(headers: [String], rows: [[String]])
    case rule

    static func parse(_ text: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        let lines = text.components(separatedBy: "\n")
        var para: [String] = []

        func flush() {
            if !para.isEmpty {
                blocks.append(.paragraph(para.joined(separator: "\n")))
                para.removeAll()
            }
        }

        var i = 0
        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.hasPrefix("```") {
                flush()
                let lang = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                var code: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    code.append(lines[i]); i += 1
                }
                i += 1   // skip closing fence
                blocks.append(.code(language: lang.isEmpty ? nil : lang, content: code.joined(separator: "\n")))
                continue
            }
            if let (table, next) = tableBlock(lines, from: i) {
                flush(); blocks.append(table); i = next; continue
            }
            if isRule(trimmed) {
                flush(); blocks.append(.rule); i += 1; continue
            }
            if let (level, rest) = heading(trimmed) {
                flush(); blocks.append(.heading(level, rest)); i += 1; continue
            }
            if let item = bulletItem(line) {
                flush()
                var items = [item]; i += 1
                while i < lines.count, let next = bulletItem(lines[i]) { items.append(next); i += 1 }
                blocks.append(.bullet(items)); continue
            }
            if let item = numberedItem(line) {
                flush()
                var items = [item]; i += 1
                while i < lines.count, let next = numberedItem(lines[i]) { items.append(next); i += 1 }
                blocks.append(.numbered(items)); continue
            }
            if trimmed.hasPrefix(">") {
                flush()
                var quote: [String] = []
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(">") {
                    let stripped = lines[i].trimmingCharacters(in: .whitespaces).dropFirst()
                    quote.append(String(stripped).trimmingCharacters(in: .whitespaces)); i += 1
                }
                blocks.append(.quote(quote.joined(separator: "\n"))); continue
            }
            if trimmed.isEmpty {
                flush(); i += 1; continue
            }
            para.append(line); i += 1
        }
        flush()
        return blocks
    }

    private static func isRule(_ s: String) -> Bool {
        guard s.count >= 3 else { return false }
        let chars = Set(s)
        return chars == ["-"] || chars == ["*"] || chars == ["_"]
    }

    /// GFM table starting at `start`: a header row of `|`-cells followed by a
    /// `|---|---|` separator, then body rows. Returns the block and the index of
    /// the first line after the table, or nil if it isn't a table.
    private static func tableBlock(_ lines: [String], from start: Int) -> (MarkdownBlock, Int)? {
        let header = lines[start].trimmingCharacters(in: .whitespaces)
        guard header.contains("|"), start + 1 < lines.count,
              isTableSeparator(lines[start + 1].trimmingCharacters(in: .whitespaces)) else { return nil }
        let headers = tableCells(header)
        guard !headers.isEmpty else { return nil }
        var rows: [[String]] = []
        var i = start + 2
        while i < lines.count {
            let t = lines[i].trimmingCharacters(in: .whitespaces)
            guard !t.isEmpty, t.contains("|") else { break }
            rows.append(tableCells(t))
            i += 1
        }
        return (.table(headers: headers, rows: rows), i)
    }

    /// Split a `| a | b |` row into trimmed cells (outer pipes optional).
    private static func tableCells(_ s: String) -> [String] {
        var t = s.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("|") { t.removeFirst() }
        if t.hasSuffix("|") { t.removeLast() }
        return t.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    /// A `|---|:--:|` separator row: every cell is dashes with optional colons.
    private static func isTableSeparator(_ s: String) -> Bool {
        guard s.contains("-"), s.contains("|") else { return false }
        let cells = tableCells(s)
        guard !cells.isEmpty else { return false }
        return cells.allSatisfy { cell in
            !cell.isEmpty && cell.contains("-") && cell.allSatisfy { $0 == "-" || $0 == ":" }
        }
    }

    private static func heading(_ s: String) -> (Int, String)? {
        guard s.hasPrefix("#") else { return nil }
        let level = s.prefix(while: { $0 == "#" }).count
        guard level <= 6 else { return nil }
        let rest = s.dropFirst(level)
        guard rest.first == " " else { return nil }
        return (level, String(rest.drop(while: { $0 == " " })))
    }

    private static func bulletItem(_ line: String) -> String? {
        let t = line.drop(while: { $0 == " " })
        guard let first = t.first, first == "-" || first == "*" || first == "+" else { return nil }
        let after = t.dropFirst()
        guard after.first == " " else { return nil }
        return String(after.dropFirst())
    }

    private static func numberedItem(_ line: String) -> String? {
        let t = line.drop(while: { $0 == " " })
        let digits = t.prefix(while: { $0.isNumber })
        guard !digits.isEmpty else { return nil }
        let after = t.dropFirst(digits.count)
        guard after.first == "." || after.first == ")" else { return nil }
        let rest = after.dropFirst()
        guard rest.first == " " else { return nil }
        return String(rest.dropFirst())
    }
}
