import Foundation
import Observation
import HerdrKit
import HerdrNet

/// Owns the list of saved herdr hosts and builds a `HerdrClient` for whichever
/// one is selected. Non-secret fields persist in UserDefaults; the SSH secret
/// lives in the Keychain.
@MainActor
@Observable
public final class ConnectionStore {
    public private(set) var connections: [ServerConnection]
    public var selectedID: ServerConnection.ID?

    private let defaultsKey = "herdrchat.connections"
    // One long-lived client (= one reused SSH connection) per host, shared by the
    // chat list and every thread so navigation never reconnects.
    @ObservationIgnored private var clients: [ServerConnection.ID: HerdrClient] = [:]

    public init() {
        if let data = UserDefaults.standard.data(forKey: defaultsKey),
           let saved = try? JSONDecoder().decode([ServerConnection].self, from: data) {
            connections = saved
        } else {
            connections = []
        }
        selectedID = connections.first?.id
        #if DEBUG
        bootstrapFromEnvironment()
        #endif
    }

    #if DEBUG
    /// Simulator/dev hook: environment variables create (or refresh) a host on
    /// launch so headless test runs connect without touching the setup UI.
    /// HERDRCHAT_BOOTSTRAP_HOST / _USER / _SECRET_B64 (base64 PEM or password),
    /// plus optional _NAME, _PORT, _AUTH=password. Debug builds only.
    private func bootstrapFromEnvironment() {
        let env = ProcessInfo.processInfo.environment
        guard let host = env["HERDRCHAT_BOOTSTRAP_HOST"],
              let username = env["HERDRCHAT_BOOTSTRAP_USER"],
              let secretB64 = env["HERDRCHAT_BOOTSTRAP_SECRET_B64"],
              let secretData = Data(base64Encoded: secretB64),
              let secret = String(data: secretData, encoding: .utf8) else { return }
        let name = env["HERDRCHAT_BOOTSTRAP_NAME"] ?? "dev"
        if let existing = connections.first(where: { $0.name == name && $0.host == host }) {
            Keychain.set(secret, for: existing.id.uuidString)
            selectedID = existing.id
            return
        }
        let connection = ServerConnection(
            name: name,
            host: host,
            port: Int(env["HERDRCHAT_BOOTSTRAP_PORT"] ?? "") ?? 22,
            username: username,
            authKind: env["HERDRCHAT_BOOTSTRAP_AUTH"] == "password" ? .password : .privateKey
        )
        save(connection, secret: secret)
    }
    #endif

    public var selected: ServerConnection? {
        connections.first { $0.id == selectedID }
    }

    /// Save (insert or update) a connection and its secret.
    public func save(_ connection: ServerConnection, secret: String?) {
        if let index = connections.firstIndex(where: { $0.id == connection.id }) {
            connections[index] = connection
        } else {
            connections.append(connection)
        }
        if let secret { Keychain.set(secret, for: connection.id.uuidString) }
        // Editing a host resets its TOFU pin: the next connect re-pins.
        Keychain.delete(Self.pinAccount(connection.id))
        selectedID = connection.id
        invalidate(connection.id)   // edited fields -> rebuild the shared client
        persist()
    }

    public func delete(_ connection: ServerConnection) {
        connections.removeAll { $0.id == connection.id }
        Keychain.delete(connection.id.uuidString)
        Keychain.delete(Self.pinAccount(connection.id))
        invalidate(connection.id)
        ThreadCache.shared.clear(connectionID: connection.id.uuidString)
        if selectedID == connection.id { selectedID = connections.first?.id }
        persist()
    }

    /// The shared herdr client for a connection (one reused SSH connection).
    public func makeClient(for connection: ServerConnection) -> HerdrClient {
        if let existing = clients[connection.id] { return existing }
        let secret = Keychain.get(connection.id.uuidString) ?? ""
        let auth: SSHConfig.Auth = switch connection.authKind {
        case .password: .password(secret)
        case .privateKey: .privateKey(pem: secret, passphrase: nil)
        }
        let config = SSHConfig(
            host: connection.host,
            port: connection.port,
            username: connection.username,
            auth: auth,
            herdrPath: connection.herdrPath,
            hostKeyPin: Self.pin(for: connection.id)
        )
        let client = HerdrClient.ssh(config)
        clients[connection.id] = client
        return client
    }

    private static func pinAccount(_ id: ServerConnection.ID) -> String { "hostkey-\(id.uuidString)" }

    /// TOFU pin storage backed by the Keychain.
    private static func pin(for id: ServerConnection.ID) -> HostKeyPin {
        let account = pinAccount(id)
        return HostKeyPin(
            load: { Keychain.get(account) },
            save: { Keychain.set($0, for: account) }
        )
    }

    /// Drop (and close) the cached connection for a host — after an edit/delete.
    private func invalidate(_ id: ServerConnection.ID) {
        ThreadSessions.shared.drop(connectionID: id.uuidString)
        guard let client = clients.removeValue(forKey: id) else { return }
        if let transport = client.transport as? SSHTransport {
            Task { await transport.disconnect() }
        }
    }

    /// Build a client from in-progress edit-form values, for a pre-save
    /// connection test. Falls back to the stored secret when editing and the
    /// secret field was left blank.
    public func makeTestClient(
        host: String,
        port: Int,
        username: String,
        authKind: ServerConnection.AuthKind,
        secret: String,
        herdrPath: String,
        fallbackId: ServerConnection.ID?
    ) -> HerdrClient {
        let resolved = secret.isEmpty ? (fallbackId.flatMap { Keychain.get($0.uuidString) } ?? "") : secret
        let auth: SSHConfig.Auth = switch authKind {
        case .password: .password(resolved)
        case .privateKey: .privateKey(pem: resolved, passphrase: nil)
        }
        let config = SSHConfig(
            host: host,
            port: port,
            username: username,
            auth: auth,
            herdrPath: herdrPath.isEmpty ? "herdr" : herdrPath,
            hostKeyPin: fallbackId.map(Self.pin(for:))   // new hosts pin on first real connect
        )
        return .ssh(config)
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(connections) {
            UserDefaults.standard.set(data, forKey: defaultsKey)
        }
    }
}
