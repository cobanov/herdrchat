import Foundation

/// High-level herdr operations over any transport. Command shapes mirror the
/// `herdr` CLI helpers, which wrap the socket API and print `{id, result}` JSON.
public struct HerdrClient: Sendable {
    public let transport: any HerdrTransport
    /// The `herdr` executable name/path on the host (overridable if not on PATH).
    private let herdr: String

    public init(transport: any HerdrTransport, herdrPath: String = "herdr") {
        self.transport = transport
        self.herdr = herdrPath
    }

    // MARK: - Reads

    public func snapshot() async throws -> Snapshot {
        let data = try await transport.run([herdr, "api", "snapshot"])
        return try HerdrJSON.decode(SnapshotResult.self, from: data).snapshot
    }

    public func workspaces() async throws -> [Workspace] {
        let data = try await transport.run([herdr, "workspace", "list"])
        return try HerdrJSON.decode(WorkspaceListResult.self, from: data).workspaces
    }

    public func agents() async throws -> [AgentInfo] {
        let data = try await transport.run([herdr, "agent", "list"])
        return try HerdrJSON.decode(AgentListResult.self, from: data).agents
    }

    public func panes() async throws -> [Pane] {
        let data = try await transport.run([herdr, "pane", "list"])
        return try HerdrJSON.decode(PaneListResult.self, from: data).panes
    }

    /// Confirms the host is reachable and herdr is answering.
    public func ping() async throws {
        _ = try await transport.run([herdr, "status", "server"])
    }

    /// The host user's home directory — the sensible starting point for browsing
    /// to a working directory in the new-chat folder picker.
    public func homeDirectory() async throws -> String {
        let data = try await transport.shell(#"printf %s "$HOME""#)
        let home = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return home.isEmpty ? "/" : home
    }

    /// Immediate subdirectories of `path` on the host (names only, sorted, hidden
    /// dirs excluded). Powers the new-chat folder picker so a working directory
    /// can be chosen by browsing the device instead of typed from memory.
    public func listDirectories(at path: String) async throws -> [String] {
        // `-p` appends "/" to directories and `-L` follows symlinked dirs, so we
        // can keep only entries ending in "/" and strip it. An unreadable path
        // yields nothing rather than erroring the picker.
        let command = "cd \(ShellQuoting.quote(path)) 2>/dev/null && ls -1Lp 2>/dev/null; true"
        let data = try await transport.shell(command)
        return String(decoding: data, as: UTF8.self)
            .split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { $0.hasSuffix("/") }
            .map { String($0.dropLast()) }
            .filter { !$0.isEmpty && $0 != "." && $0 != ".." }
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    // MARK: - Writes

    /// Type a chat message into an agent pane and submit it. `pane run` sends the
    /// text and a real Enter in one request — a separate `send-keys enter` types
    /// the text but doesn't submit inside an agent TUI (only in a plain shell).
    public func sendMessage(toPane paneId: String, text: String) async throws {
        try check(await transport.run([herdr, "pane", "run", paneId, text]))
    }

    /// Send raw keys to a pane, e.g. quick-reply to a blocked prompt.
    public func sendKeys(toPane paneId: String, keys: [String]) async throws {
        try check(await transport.run([herdr, "pane", "send-keys", paneId] + keys))
    }

    /// Create a new workspace rooted at `cwd` (optional `label`) without stealing
    /// focus on the desktop, and return its ids. Follow with `startAgent` on the
    /// returned root pane to launch Claude in it.
    public func createWorkspace(cwd: String, label: String?) async throws -> WorkspaceCreation {
        var args = [herdr, "workspace", "create", "--cwd", cwd, "--no-focus"]
        if let label, !label.isEmpty { args += ["--label", label] }
        let data = try await transport.run(args)
        return try HerdrJSON.decode(WorkspaceCreation.self, from: data)
    }

    /// Launch an agent in a freshly created pane's shell (e.g. run "claude").
    /// Uses `pane run`, which types the command and presses Enter in one request.
    public func startAgent(inPane paneId: String, command: String = "claude") async throws {
        try check(await transport.run([herdr, "pane", "run", paneId, command]))
    }

    /// Block until the agent in a pane reaches `status` (true) or the timeout
    /// elapses (false). Backs delivery verification: after submitting a prompt
    /// the agent should flip to `working`.
    public func waitAgentStatus(pane paneId: String, status: AgentStatus, timeoutMs: Int) async -> Bool {
        do {
            _ = try await transport.run([
                herdr, "agent", "wait", paneId,
                "--status", status.rawValue,
                "--timeout", String(timeoutMs),
            ])
            return true
        } catch {
            return false   // timeout (exit 1) or transport error
        }
    }

    /// The pane's currently VISIBLE screen — needed to read Claude's on-screen
    /// choice menus (permission prompts, AskUserQuestion). Claude runs on the
    /// terminal's alternate screen, so `recent`/`recent-unwrapped` (scrollback)
    /// come back empty; only `visible` captures the live menu.
    public func paneVisible(pane paneId: String, lines: Int) async throws -> String {
        let data = try await transport.run([
            herdr, "pane", "read", paneId,
            "--source", "visible",
            "--lines", String(lines),
        ])
        return String(decoding: data, as: UTF8.self)
    }

    // Surface a transported error if the CLI printed an envelope; commands like
    // `pane run` / `send-keys` print NOTHING on success, so empty output is OK.
    private func check(_ data: Data) throws {
        let text = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        _ = try HerdrJSON.decode(IgnoredResult.self, from: data)
    }
}
