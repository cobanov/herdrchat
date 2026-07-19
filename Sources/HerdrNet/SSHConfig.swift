import Foundation

/// Connection details for reaching a herdr host over SSH (typically a Tailscale
/// address). Persisted by the app; the private key / password is stored in the
/// Keychain, not here.
public struct SSHConfig: Sendable, Equatable {
    public enum Auth: Sendable, Equatable {
        case password(String)
        /// An OpenSSH-format private key (ed25519 or RSA), e.g. the contents of
        /// `~/.ssh/id_ed25519`, with an optional passphrase decrypt.
        case privateKey(pem: String, passphrase: String?)
    }

    public var host: String
    public var port: Int
    public var username: String
    public var auth: Auth
    /// Path to the herdr binary on the host if it isn't on the non-interactive PATH.
    public var herdrPath: String
    /// Optional trust-on-first-use pin storage. When set, the first connection
    /// stores the server's host-key fingerprint and later connections must match.
    public var hostKeyPin: HostKeyPin?

    public init(
        host: String,
        port: Int = 22,
        username: String,
        auth: Auth,
        herdrPath: String = "herdr",
        hostKeyPin: HostKeyPin? = nil
    ) {
        self.host = host
        self.port = port
        self.username = username
        self.auth = auth
        self.herdrPath = herdrPath
        self.hostKeyPin = hostKeyPin
    }
}

/// Storage hooks for TOFU host-key pinning; the app backs these with Keychain.
public struct HostKeyPin: Sendable, Equatable {
    public let load: @Sendable () -> String?
    public let save: @Sendable (String) -> Void

    public init(load: @escaping @Sendable () -> String?, save: @escaping @Sendable (String) -> Void) {
        self.load = load
        self.save = save
    }

    // Closures aren't equatable; SSHConfig equality ignores the pin hooks.
    public static func == (lhs: HostKeyPin, rhs: HostKeyPin) -> Bool { true }
}
