#if os(macOS)
import Foundation

/// Runs commands on the local machine via a login shell. Used for development
/// and verification on the box that actually runs herdr (this Mac). A login
/// shell is used so `herdr` resolves on PATH the same way it does in a terminal.
public struct LocalProcessTransport: HerdrTransport {
    private let loginShell: String

    public init(loginShell: String = "/bin/zsh") {
        self.loginShell = loginShell
    }

    public func shell(_ command: String) async throws -> Data {
        let shellPath = loginShell
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process()
                process.executableURL = URL(fileURLWithPath: shellPath)
                process.arguments = ["-lc", command]
                let out = Pipe()
                let err = Pipe()
                process.standardOutput = out
                process.standardError = err
                do {
                    try process.run()
                } catch {
                    continuation.resume(throwing: error)
                    return
                }
                let data = out.fileHandleForReading.readDataToEndOfFile()
                let errData = err.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                if process.terminationStatus != 0 {
                    let message = String(decoding: errData, as: UTF8.self)
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    continuation.resume(throwing: HerdrError(
                        code: "process_failed",
                        message: message.isEmpty ? "exit code \(process.terminationStatus)" : message
                    ))
                } else {
                    continuation.resume(returning: data)
                }
            }
        }
    }

    public func streamLines(_ command: String) -> AsyncThrowingStream<String, Error> {
        let shellPath = loginShell
        return AsyncThrowingStream { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: shellPath)
            process.arguments = ["-lc", command]
            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = Pipe()

            // readabilityHandler invocations are serialized by Foundation, so a
            // plain buffer without extra locking is safe here.
            let buffer = ByteBuffer()
            let handle = pipe.fileHandleForReading
            handle.readabilityHandler = { fileHandle in
                let chunk = fileHandle.availableData
                guard !chunk.isEmpty else { return }
                for line in buffer.appendAndTakeLines(chunk) {
                    continuation.yield(line)
                }
            }

            process.terminationHandler = { _ in
                handle.readabilityHandler = nil
                if let tail = buffer.flushRemainder() { continuation.yield(tail) }
                continuation.finish()
            }

            continuation.onTermination = { _ in
                handle.readabilityHandler = nil
                if process.isRunning { process.terminate() }
            }

            do {
                try process.run()
            } catch {
                continuation.finish(throwing: error)
            }
        }
    }
}

/// Accumulates bytes and hands back complete newline-terminated lines.
private final class ByteBuffer: @unchecked Sendable {
    private var data = Data()

    func appendAndTakeLines(_ chunk: Data) -> [String] {
        data.append(chunk)
        var lines: [String] = []
        while let newline = data.firstIndex(of: 0x0A) {
            let lineData = data[data.startIndex..<newline]
            lines.append(String(decoding: lineData, as: UTF8.self))
            data.removeSubrange(data.startIndex...newline)
        }
        return lines
    }

    func flushRemainder() -> String? {
        guard !data.isEmpty else { return nil }
        defer { data.removeAll() }
        return String(decoding: data, as: UTF8.self)
    }
}
#endif
