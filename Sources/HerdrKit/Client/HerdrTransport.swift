import Foundation

/// How commands reach a machine that runs herdr. Everything HerdrChat does is a
/// shell command on that host: `herdr <subcommand>` for control, `tail`/`ls`/`cat`
/// for reading Claude transcripts. The app uses an SSH-over-Tailscale transport;
/// a local process transport exists for development on the herdr host itself.
public protocol HerdrTransport: Sendable {
    /// Run a shell command, returning stdout. Throws `HerdrError` on non-zero exit.
    func shell(_ command: String) async throws -> Data

    /// Run a long-lived command (e.g. `tail -f`) and stream its stdout lines.
    func streamLines(_ command: String) -> AsyncThrowingStream<String, Error>
}

public extension HerdrTransport {
    /// Run an argv without a shell interpreting it, by quoting each element.
    func run(_ argv: [String]) async throws -> Data {
        try await shell(argv.map(ShellQuoting.quote).joined(separator: " "))
    }
}

/// POSIX single-quote quoting so arbitrary user text is safe inside a command.
public enum ShellQuoting {
    public static func quote(_ argument: String) -> String {
        "'" + argument.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}
