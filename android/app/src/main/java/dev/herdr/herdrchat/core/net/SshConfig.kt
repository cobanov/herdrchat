package dev.herdr.herdrchat.core.net

/** Connection details for reaching a herdr host over SSH (typically a Tailscale
 *  address). The secret (key or password) is stored encrypted by the app. */
data class SshConfig(
    val host: String,
    val port: Int = 22,
    val username: String,
    val auth: SshAuth,
    /** Path to the herdr binary on the host if it isn't on the non-interactive PATH. */
    val herdrPath: String = "herdr",
)

sealed interface SshAuth {
    data class Password(val password: String) : SshAuth

    /** An OpenSSH-format private key (ed25519 or RSA), with an optional passphrase. */
    data class PrivateKey(val pem: String, val passphrase: String?) : SshAuth
}
