import Foundation

/// One streamed transcript line: the parsed bubble (nil for non-message lines)
/// and the running byte offset consumed, so a re-open can resume from there.
public struct TailChunk: Sendable {
    public let message: ChatMessage?
    public let consumedBytes: Int
}

/// Reads Claude Code transcripts on the herdr host so chat threads show clean
/// message bubbles instead of the raw TUI buffer. Given a pane's cwd, it finds
/// the newest session `.jsonl` under `~/.claude/projects/<escaped-cwd>/` and
/// either loads it once or tails it for live updates.
public struct TranscriptStore: Sendable {
    public let transport: any HerdrTransport

    public init(transport: any HerdrTransport) {
        self.transport = transport
    }

    /// The host user's home directory (resolved once by the caller and cached;
    /// stored transcript paths must be absolute so shell quoting stays safe).
    public func homeDirectory() async throws -> String {
        let data = try await transport.shell(#"printf %s "$HOME""#)
        let home = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return home.isEmpty ? "~" : home
    }

    /// Exact transcript path for a known agent session id — the authoritative
    /// target (herdr's `agent_session.value` IS the transcript filename for
    /// Claude Code). Falls back to `newestTranscriptPath` only when no session
    /// reference is available.
    public func sessionTranscriptPath(home: String, cwd: String, sessionId: String) -> String? {
        // Session ids are UUIDs; refuse anything that isn't [A-Za-z0-9-] so the
        // path stays shell-safe under quoting.
        guard !sessionId.isEmpty,
              sessionId.allSatisfy({ ($0.isLetter && $0.isASCII) || $0.isNumber || $0 == "-" }) else {
            return nil
        }
        let dir = TranscriptParser.projectDirName(forCwd: cwd)
        return "\(home)/.claude/projects/\(dir)/\(sessionId).jsonl"
    }

    /// Path to the most recently modified transcript for a working directory,
    /// or nil if the agent has no transcript there yet.
    public func newestTranscriptPath(forCwd cwd: String) async throws -> String? {
        let dir = TranscriptParser.projectDirName(forCwd: cwd)
        // dir is [A-Za-z0-9-] only, safe to interpolate; $HOME expands on the host.
        let command = #"ls -t "$HOME/.claude/projects/\#(dir)"/*.jsonl 2>/dev/null | head -1"#
        let data = try await transport.shell(command)
        let path = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return path.isEmpty ? nil : path
    }

    /// Load and parse a transcript file in full.
    public func loadMessages(atPath path: String, agentLabel: String?) async throws -> [ChatMessage] {
        let data = try await transport.shell("cat \(ShellQuoting.quote(path))")
        return TranscriptParser.parse(String(decoding: data, as: UTF8.self), agentLabel: agentLabel)
    }

    /// Stream chat messages as they are appended to a transcript. Emits existing
    /// content first (`tail -n +1`) then follows the file.
    public func tailMessages(atPath path: String, agentLabel: String?) -> AsyncThrowingStream<ChatMessage, Error> {
        let lines = transport.streamLines("tail -n +1 -f \(ShellQuoting.quote(path))")
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await line in lines {
                        if let message = TranscriptParser.message(fromLine: line, agentLabel: agentLabel) {
                            continuation.yield(message)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Bulk-load only the most recent slice of a transcript in one read and parse,
    /// instead of streaming the whole (possibly multi-MB) file line by line.
    /// Returns the parsed bubbles plus the byte offset consumed, so the live tail
    /// can follow from exactly there.
    ///
    /// Two independent limits, because bytes are a poor proxy for conversation
    /// length in either direction: one turn can be megabytes (image tool-results
    /// embed base64), and a megabyte can hold thousands of terse turns.
    /// `maxBytes` bounds the transfer; `maxMessages` bounds what the chat surface
    /// has to lay out. Older history stays on disk untouched.
    public func recent(
        atPath path: String,
        agentLabel: String?,
        maxBytes: Int,
        maxMessages: Int? = nil
    ) async throws -> (messages: [ChatMessage], consumedBytes: Int) {
        let size = try await fileSize(atPath: path)
        let start = size > maxBytes ? size - maxBytes : 0
        let data = try await transport.shell("tail -c +\(start + 1) \(ShellQuoting.quote(path))")
        var text = String(decoding: data, as: UTF8.self)
        // A window that starts mid-file almost always starts mid-line. Drop that
        // fragment explicitly rather than relying on it failing to parse — a
        // truncated line can still decode into a half-formed bubble.
        if start > 0, let firstNewline = text.firstIndex(of: "\n") {
            text = String(text[text.index(after: firstNewline)...])
        }
        var messages = TranscriptParser.parse(text, agentLabel: agentLabel)
        if let maxMessages, messages.count > maxMessages {
            messages.removeFirst(messages.count - maxMessages)
        }
        // Consumed is the whole window regardless of what we kept or dropped:
        // the tail must resume at the real EOF, not at the first bubble shown.
        return (messages, start + data.count)
    }

    /// Model + context size for the chat header: read the transcript tail and
    /// take the newest assistant line's model and prompt-token total. One small
    /// round-trip; nil when the tail holds no assistant turn with usage yet.
    public func sessionMeta(atPath path: String, tailBytes: Int = 262_144) async throws -> SessionMeta? {
        let data = try await transport.shell("tail -c \(tailBytes) \(ShellQuoting.quote(path)) 2>/dev/null")
        let text = String(decoding: data, as: UTF8.self)
        var model: String?
        var context: Int?
        for line in text.split(separator: "\n").reversed() {
            guard let meta = TranscriptParser.assistantMeta(fromLine: line) else { continue }
            if model == nil { model = meta.model }
            if context == nil { context = meta.contextTokens }
            if model != nil, context != nil { break }
        }
        guard model != nil || context != nil else { return nil }
        return SessionMeta(model: model, contextTokens: context)
    }

    /// Current file size in bytes, or -1 if unknown. Used to decide whether a
    /// cached byte offset is still valid (file grew) or the file rotated.
    public func fileSize(atPath path: String) async throws -> Int {
        let data = try await transport.shell("wc -c < \(ShellQuoting.quote(path)) 2>/dev/null")
        let text = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return Int(text) ?? -1
    }

    /// One workspace's "last message" lookup: which transcript to peek for the
    /// chat-list preview (exact session file when the integration reports one,
    /// newest `.jsonl` in the project dir otherwise).
    public struct PreviewRequest: Sendable {
        public let workspaceId: String
        public let cwd: String
        public let sessionId: String?

        public init(workspaceId: String, cwd: String, sessionId: String?) {
            self.workspaceId = workspaceId
            self.cwd = cwd
            self.sessionId = sessionId
        }
    }

    /// Fetch the tail of every workspace's transcript in ONE round-trip and
    /// return the newest displayable message per workspace — the data behind the
    /// Messages-style "last message" line in the chat list. A partial first
    /// line (tail starting mid-line) fails to parse and is dropped; workspaces
    /// with no transcript are simply absent from the result.
    public func latestMessages(
        for requests: [PreviewRequest],
        tailBytes: Int = 48_000
    ) async throws -> [String: ChatMessage] {
        var script = ""
        for request in requests {
            // Workspace ids / session ids are interpolated into the script and
            // the marker line: refuse anything that isn't obviously inert.
            guard request.workspaceId.allSatisfy({
                ($0.isLetter && $0.isASCII) || $0.isNumber || $0 == ":" || $0 == "-" || $0 == "_"
            }) else { continue }
            let dir = TranscriptParser.projectDirName(forCwd: request.cwd)
            let resolve: String
            if let sid = request.sessionId, !sid.isEmpty,
               sid.allSatisfy({ ($0.isLetter && $0.isASCII) || $0.isNumber || $0 == "-" }) {
                // Exact session file only — never fall back to the newest (a
                // previous session's) transcript, so the list can't preview a
                // foreign chat's last message under a reused workspace.
                resolve = #"f="$HOME/.claude/projects/\#(dir)/\#(sid).jsonl"; "#
            } else {
                resolve = #"f=$(ls -t "$HOME/.claude/projects/\#(dir)"/*.jsonl 2>/dev/null | head -1); "#
            }
            script += resolve
            script += #"printf '\n@@HERDRCHAT %s\n' '\#(request.workspaceId)'; "#
            script += #"[ -n "$f" ] && tail -c \#(tailBytes) "$f" 2>/dev/null; "#
        }
        guard !script.isEmpty else { return [:] }
        script += "true"   // a workspace without a transcript must not fail the batch
        let data = try await transport.shell(script)
        let text = String(decoding: data, as: UTF8.self)

        var result: [String: ChatMessage] = [:]
        for block in text.components(separatedBy: "\n@@HERDRCHAT ").dropFirst() {
            guard let headerEnd = block.firstIndex(of: "\n") else { continue }
            let workspaceId = String(block[..<headerEnd]).trimmingCharacters(in: .whitespaces)
            let body = String(block[block.index(after: headerEnd)...])
            let messages = TranscriptParser.parse(body)
            if let last = messages.last(where: { !$0.isSidechain && !$0.isToolOnly }) {
                result[workspaceId] = last
            }
        }
        return result
    }

    /// Stream transcript lines from `startByte` to end, then follow appends.
    /// `startByte == 0` reads the whole file. Each chunk carries the running byte
    /// offset so the caller can persist it and resume later without re-reading.
    public func tail(atPath path: String, agentLabel: String?, startByte: Int) -> AsyncThrowingStream<TailChunk, Error> {
        let lines = transport.streamLines("tail -c +\(startByte + 1) -f \(ShellQuoting.quote(path))")
        return AsyncThrowingStream { continuation in
            let task = Task {
                var consumed = startByte
                do {
                    for try await line in lines {
                        consumed += line.utf8.count + 1   // + newline
                        continuation.yield(TailChunk(
                            message: TranscriptParser.message(fromLine: line, agentLabel: agentLabel),
                            consumedBytes: consumed
                        ))
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
