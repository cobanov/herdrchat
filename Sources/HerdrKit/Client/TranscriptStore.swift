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

    /// Bulk-load only the most recent `maxBytes` of a transcript in one read and
    /// parse, instead of streaming the whole (possibly multi-MB) file line by
    /// line. Returns the parsed bubbles plus the byte offset consumed, so the
    /// live tail can follow from exactly there. A partial first line (when the
    /// window starts mid-file) simply fails to parse and is dropped.
    public func recent(atPath path: String, agentLabel: String?, maxBytes: Int) async throws -> (messages: [ChatMessage], consumedBytes: Int) {
        let size = try await fileSize(atPath: path)
        let start = size > maxBytes ? size - maxBytes : 0
        let data = try await transport.shell("tail -c +\(start + 1) \(ShellQuoting.quote(path))")
        let text = String(decoding: data, as: UTF8.self)
        return (TranscriptParser.parse(text, agentLabel: agentLabel), start + data.count)
    }

    /// Current file size in bytes, or -1 if unknown. Used to decide whether a
    /// cached byte offset is still valid (file grew) or the file rotated.
    public func fileSize(atPath path: String) async throws -> Int {
        let data = try await transport.shell("wc -c < \(ShellQuoting.quote(path)) 2>/dev/null")
        let text = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return Int(text) ?? -1
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
