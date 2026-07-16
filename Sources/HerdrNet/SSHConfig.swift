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

    public init(
        host: String,
        port: Int = 22,
        username: String,
        auth: Auth,
        herdrPath: String = "herdr"
    ) {
        self.host = host
        self.port = port
        self.username = username
        self.auth = auth
        self.herdrPath = herdrPath
    }
}
