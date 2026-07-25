import Foundation

/// Discovers the slash commands available on the host for a given working
/// directory.
///
/// Claude Code renders its own palette when you type `/`, but that overlay is
/// clipped to the pane's viewport and scrolls — scraping it would only ever
/// return the handful of rows that happened to fit. The definitions on disk are
/// the durable source, so they are read directly: one round trip for user and
/// project commands plus skills, merged with the built-in list.
public struct SlashCommandStore: Sendable {
    public let transport: any HerdrTransport

    public init(transport: any HerdrTransport) {
        self.transport = transport
    }

    private static let marker = "@@HERDRCMD"
    /// Palette rows are one line; a whole skill description would swamp them.
    private static let summaryLimit = 160

    /// Built-ins plus everything defined on the host for `cwd`, de-duplicated by
    /// name (a project definition wins over a user one, which wins over a
    /// built-in) and sorted by name.
    public func discover(cwd: String) async throws -> [SlashCommand] {
        let discovered = (try? await hostDefined(cwd: cwd)) ?? []
        var byName: [String: SlashCommand] = [:]
        // Insert in ascending precedence so later writes win.
        for command in SlashCommand.builtIns { byName[command.name] = command }
        for command in discovered { byName[command.name] = command }
        return byName.values.sorted { $0.name < $1.name }
    }

    private func hostDefined(cwd: String) async throws -> [SlashCommand] {
        let data = try await transport.shell(script(cwd: cwd))
        return parse(String(decoding: data, as: UTF8.self))
    }

    /// Emits `@@HERDRCMD <source> <name>` followed by the description line, for
    /// every command and skill definition in the four locations Claude Code reads.
    private func script(cwd: String) -> String {
        let quotedCwd = ShellQuoting.quote(cwd)
        // The description is read with awk rather than a one-line sed because real
        // frontmatter uses YAML block scalars: several skills on a live host write
        // `description: >-` and put the text on the following indented lines. A
        // first-line grab returns the literal ">-" for those.
        return """
        emit() {
          printf '%s %s %s\\n' '\(Self.marker)' "$1" "$2"
          awk '
            /^description:[[:space:]]*/ && !seen {
              seen = 1
              value = $0
              sub(/^description:[[:space:]]*/, "", value)
              if (value ~ /^[>|][-+]?$/) { block = 1; next }
              print value
              exit
            }
            block {
              if ($0 ~ /^[[:space:]]+[^[:space:]]/) {
                gsub(/^[[:space:]]+/, "")
                folded = (folded == "" ? $0 : folded " " $0)
                next
              }
              if (folded != "") print folded
              exit
            }
            END { if (block && folded != "") print folded }
          ' "$3" 2>/dev/null
        }
        commands() {
          [ -d "$2" ] || return 0
          for f in "$2"/*.md; do
            [ -f "$f" ] || continue
            emit "$1" "$(basename "$f" .md)" "$f"
          done
        }
        skills() {
          [ -d "$2" ] || return 0
          for d in "$2"/*/; do
            [ -f "$d/SKILL.md" ] || continue
            emit "$1" "$(basename "$d")" "$d/SKILL.md"
          done
        }
        commands userCommand "$HOME/.claude/commands"
        skills userSkill "$HOME/.claude/skills"
        commands projectCommand \(quotedCwd)/.claude/commands
        skills projectSkill \(quotedCwd)/.claude/skills
        true
        """
    }

    func parse(_ output: String) -> [SlashCommand] {
        var result: [SlashCommand] = []
        for block in output.components(separatedBy: "\(Self.marker) ").dropFirst() {
            var lines = block.components(separatedBy: "\n")
            guard !lines.isEmpty else { continue }
            let header = lines.removeFirst().split(separator: " ", maxSplits: 1)
            guard header.count == 2,
                  let source = SlashCommand.Source(rawValue: String(header[0])) else { continue }
            let name = String(header[1]).trimmingCharacters(in: .whitespaces)
            guard !name.isEmpty else { continue }
            result.append(SlashCommand(
                name: name,
                summary: summary(from: lines.first),
                source: source
            ))
        }
        return result
    }

    /// Frontmatter descriptions are often quoted and can run for paragraphs.
    private func summary(from line: String?) -> String? {
        guard var text = line?.trimmingCharacters(in: .whitespaces), !text.isEmpty else { return nil }
        for quote in ["\"", "'"] where text.hasPrefix(quote) {
            text = String(text.dropFirst())
            if text.hasSuffix(quote) { text = String(text.dropLast()) }
            break
        }
        text = text.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return nil }
        guard text.count > Self.summaryLimit else { return text }
        return text.prefix(Self.summaryLimit).trimmingCharacters(in: .whitespaces) + "…"
    }
}
