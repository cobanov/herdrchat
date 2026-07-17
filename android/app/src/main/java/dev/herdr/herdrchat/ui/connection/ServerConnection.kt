package dev.herdr.herdrchat.ui.connection

import kotlinx.serialization.Serializable
import java.util.UUID

/** A saved herdr host the app can open a chat session against. Secrets (password
 *  or private key) live in encrypted storage keyed by [id]; only non-secret fields
 *  are persisted here. */
@Serializable
data class ServerConnection(
    val id: String = UUID.randomUUID().toString(),
    val name: String,               // display name, e.g. "nuc"
    val host: String,               // Tailscale address or hostname
    val port: Int = 22,
    val username: String,
    val authKind: AuthKind = AuthKind.PRIVATE_KEY,
    val herdrPath: String = "herdr",
) {
    enum class AuthKind { PASSWORD, PRIVATE_KEY }
}
