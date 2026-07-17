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
