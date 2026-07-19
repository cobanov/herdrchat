import Foundation

/// Turns Claude Code transcript JSONL (one JSON object per line) into chat
/// bubbles. This is what gives the WhatsApp view clean messages instead of the
/// raw TUI buffer: Claude writes every turn to
/// `~/.claude/projects/<escaped-cwd>/<sessionId>.jsonl`.
public enum TranscriptParser {

    /// Parse a whole transcript file's contents.
    /// - Parameter agentLabel: stamped onto every message (used when a workspace
    ///   thread merges output from more than one agent).
    public static func parse(_ contents: String, agentLabel: String? = nil) -> [ChatMessage] {
        contents
            .split(separator: "\n", omittingEmptySubsequences: true)
            .compactMap { message(fromLine: $0, agentLabel: agentLabel) }
    }

    /// Parse a single JSONL line. Returns nil for non-conversational entries
    /// (mode, permission-mode, hook system output, snapshots, attachments) and
    /// for turns that carry no segments.
    public static func message<S: StringProtocol>(fromLine line: S, agentLabel: String? = nil) -> ChatMessage? {
        guard let data = String(line).data(using: .utf8),
              let raw = try? decoder.decode(RawEntry.self, from: data) else { return nil }

        let role: ChatMessage.Role
        switch raw.type {
        case "user": role = .user
        case "assistant": role = .assistant
        default: return nil   // system/mode/attachment/etc. are not bubbles
        }

        let segments = segments(from: raw.message?.content)
        guard !segments.isEmpty else { return nil }

        return ChatMessage(
            id: raw.uuid ?? UUID().uuidString,
            role: role,
            segments: segments,
            timestamp: raw.timestamp.flatMap(parseTimestamp),
            agentLabel: agentLabel,
            isSidechain: raw.isSidechain ?? false
        )
    }

    /// Claude escapes a cwd into a project directory name by replacing every
    /// character that is not ASCII-alphanumeric with a hyphen, e.g.
    /// `/Users/x/Documents/obsidian/07_homelab` -> `-Users-x-Documents-obsidian-07-homelab`
    /// (verified empirically against ~/.claude/projects). Restricting the output
    /// to `[A-Za-z0-9-]` also keeps the name shell-safe when interpolated.
    public static func projectDirName(forCwd cwd: String) -> String {
        String(cwd.map { char in
            char.isASCII && (char.isLetter || char.isNumber) ? char : "-"
        })
    }

    // MARK: - Internals

    private static func segments(from content: RawContent?) -> [MessageSegment] {
        switch content {
        case .none:
            return []
        case .text(let string):
            let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? [] : [.text(string)]
        case .blocks(let blocks):
            return blocks.compactMap(segment(from:))
        }
    }

    private static func segment(from block: RawBlock) -> MessageSegment? {
        switch block.type {
        case "text":
            guard let text = block.text, !text.isEmpty else { return nil }
            return .text(text)
        case "thinking":
            guard let thinking = block.thinking, !thinking.isEmpty else { return nil }
            return .thinking(thinking)
        case "tool_use":
            return .toolUse(name: block.name ?? "tool", input: block.input?.compactString)
        case "tool_result":
            let text = flatten(block.content)
            return .toolResult(text)
        default:
            return nil
        }
    }

    private static func flatten(_ content: RawContent?) -> String {
        switch content {
        case .none: return ""
        case .text(let string): return string
        case .blocks(let blocks): return blocks.compactMap(\.text).joined(separator: "\n")
        }
    }

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    // ISO8601DateFormatter isn't Sendable and its parsing isn't thread-safe, so
    // build one per call. Parsing runs off a background task per thread anyway.
    private static func parseTimestamp(_ string: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: string) ?? ISO8601DateFormatter().date(from: string)
    }
}

// MARK: - Raw JSONL shapes

private struct RawEntry: Decodable {
    let type: String
    let uuid: String?
    let parentUuid: String?
    let timestamp: String?
    let isSidechain: Bool?
    let cwd: String?
    let message: RawMessage?
}

private struct RawMessage: Decodable {
    let role: String?
    let content: RawContent?
}

private struct RawBlock: Decodable {
    let type: String
    let text: String?
    let thinking: String?
    let name: String?          // tool_use
    let input: JSONValue?      // tool_use input (arbitrary JSON)
    let toolUseId: String?     // tool_result (tool_use_id)
    let content: RawContent?   // tool_result content (string or blocks)
}

/// `content` is either a plain string (user turns) or an array of typed blocks
/// (assistant turns, tool results).
private enum RawContent: Decodable {
    case text(String)
    case blocks([RawBlock])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let string = try? container.decode(String.self) {
            self = .text(string)
        } else {
            self = .blocks(try container.decode([RawBlock].self))
        }
    }
}

/// Minimal arbitrary-JSON holder so tool inputs decode without a fixed schema.
private enum JSONValue: Decodable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let bool = try? container.decode(Bool.self) { self = .bool(bool) }
        else if let number = try? container.decode(Double.self) { self = .number(number) }
        else if let string = try? container.decode(String.self) { self = .string(string) }
        else if let array = try? container.decode([JSONValue].self) { self = .array(array) }
        else if let object = try? container.decode([String: JSONValue].self) { self = .object(object) }
        else { self = .null }
    }

    /// A short single-line preview for a tool-use chip.
    var compactString: String {
        switch self {
        case .string(let value): return value
        case .number(let value): return value == value.rounded() ? String(Int(value)) : String(value)
        case .bool(let value): return String(value)
        case .null: return "null"
        case .array(let values): return "[" + values.map(\.compactString).joined(separator: ", ") + "]"
        case .object(let dict):
            return "{" + dict.map { "\($0): \($1.compactString)" }.joined(separator: ", ") + "}"
        }
    }
}
