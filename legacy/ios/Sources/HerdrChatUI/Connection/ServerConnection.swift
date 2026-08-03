import Foundation

/// A saved herdr host the app can open a chat session against. Secrets (password
/// or private key) live in the Keychain keyed by `id`; only non-secret fields
/// are persisted here.
public struct ServerConnection: Codable, Identifiable, Sendable, Equatable {
    public enum AuthKind: String, Codable, Sendable {
        case password
        case privateKey
    }

    public var id: UUID
    public var name: String       // display name, e.g. "nuc"
    public var host: String       // Tailscale address or hostname
    public var port: Int
    public var username: String
    public var authKind: AuthKind
    public var herdrPath: String

    public init(
        id: UUID = UUID(),
        name: String,
        host: String,
        port: Int = 22,
        username: String,
        authKind: AuthKind = .privateKey,
        herdrPath: String = "herdr"
    ) {
        self.id = id
        self.name = name
        self.host = host
        self.port = port
        self.username = username
        self.authKind = authKind
        self.herdrPath = herdrPath
    }
}
