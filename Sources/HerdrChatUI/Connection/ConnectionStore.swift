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

    public init() {
        if let data = UserDefaults.standard.data(forKey: defaultsKey),
           let saved = try? JSONDecoder().decode([ServerConnection].self, from: data) {
            connections = saved
        } else {
            connections = []
        }
        selectedID = connections.first?.id
    }

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
        selectedID = connection.id
        persist()
    }

    public func delete(_ connection: ServerConnection) {
        connections.removeAll { $0.id == connection.id }
        Keychain.delete(connection.id.uuidString)
        if selectedID == connection.id { selectedID = connections.first?.id }
        persist()
    }

    /// Build a herdr client for a connection, pulling its secret from Keychain.
    public func makeClient(for connection: ServerConnection) -> HerdrClient {
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
            herdrPath: connection.herdrPath
        )
        return .ssh(config)
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(connections) {
            UserDefaults.standard.set(data, forKey: defaultsKey)
        }
    }
}
