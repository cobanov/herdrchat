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

    // Surface a transported error if the CLI printed an envelope; commands like
    // `pane run` / `send-keys` print NOTHING on success, so empty output is OK.
    private func check(_ data: Data) throws {
        let text = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        _ = try HerdrJSON.decode(IgnoredResult.self, from: data)
    }
}
