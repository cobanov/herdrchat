package dev.herdr.herdrchat.ui.connection

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.herdr.herdrchat.core.client.HerdrClient
import dev.herdr.herdrchat.core.net.SshAuth
import dev.herdr.herdrchat.core.net.SshConfig
import dev.herdr.herdrchat.core.net.SshTransport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * Owns the list of saved herdr hosts and builds a [HerdrClient] for whichever one
 * is selected. Non-secret fields persist in SharedPreferences; the SSH secret
 * lives in the encrypted [SecretStore].
 */
class ConnectionStore(context: Context) {

    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences("herdrchat", Context.MODE_PRIVATE)
    private val secrets = SecretStore(appContext)
    private val json = Json { ignoreUnknownKeys = true }
    private val listSerializer = ListSerializer(ServerConnection.serializer())

    var connections by mutableStateOf(load())
        private set
    var selectedId by mutableStateOf(connections.firstOrNull()?.id)

    // One long-lived client (= one reused SSH connection) per host, shared by the
    // chat list and every thread so navigation never reconnects.
    private val clients = mutableMapOf<String, HerdrClient>()

    val selected: ServerConnection? get() = connections.firstOrNull { it.id == selectedId }

    /** Save (insert or update) a connection and its secret. */
    fun save(connection: ServerConnection, secret: String?) {
        val idx = connections.indexOfFirst { it.id == connection.id }
        connections = if (idx >= 0) {
            connections.toMutableList().also { it[idx] = connection }
        } else {
            connections + connection
        }
        if (secret != null) secrets.set(connection.id, secret)
        selectedId = connection.id
        invalidate(connection.id)   // edited fields -> rebuild the shared client
        persist()
    }

    fun delete(connection: ServerConnection) {
        connections = connections.filterNot { it.id == connection.id }
        secrets.delete(connection.id)
        invalidate(connection.id)
        if (selectedId == connection.id) selectedId = connections.firstOrNull()?.id
        persist()
    }

    /** The shared herdr client for a connection (one reused SSH connection). */
    fun makeClient(connection: ServerConnection): HerdrClient =
        clients.getOrPut(connection.id) { buildClient(connection) }

    /** A throwaway client from in-progress edit-form values (unshared). */
    private fun buildClient(
        host: String,
        port: Int,
        username: String,
        authKind: ServerConnection.AuthKind,
        secret: String,
        herdrPath: String,
    ): HerdrClient {
        val auth: SshAuth = when (authKind) {
            ServerConnection.AuthKind.PASSWORD -> SshAuth.Password(secret)
            ServerConnection.AuthKind.PRIVATE_KEY -> SshAuth.PrivateKey(secret, null)
        }
        val herdr = herdrPath.ifBlank { "herdr" }
        return HerdrClient(SshTransport(SshConfig(host, port, username, auth, herdr)), herdr)
    }

    private fun buildClient(connection: ServerConnection): HerdrClient =
        buildClient(
            host = connection.host,
            port = connection.port,
            username = connection.username,
            authKind = connection.authKind,
            secret = secrets.get(connection.id) ?: "",
            herdrPath = connection.herdrPath,
        )

    /** Drop (and close) the cached connection for a host — after an edit/delete. */
    private fun invalidate(connectionId: String) {
        val client = clients.remove(connectionId) ?: return
        (client.transport as? SshTransport)?.let { transport ->
            CoroutineScope(Dispatchers.IO).launch { runCatching { transport.disconnect() } }
        }
    }

    /** Build a client from in-progress edit-form values, for a pre-save
     *  connection test. Falls back to the stored secret when [fallbackId] is set
     *  and the secret field was left blank. */
    fun makeTestClient(
        host: String,
        port: Int,
        username: String,
        authKind: ServerConnection.AuthKind,
        secret: String,
        herdrPath: String,
        fallbackId: String?,
    ): HerdrClient {
        val resolved = if (secret.isEmpty() && fallbackId != null) secrets.get(fallbackId) ?: "" else secret
        return buildClient(host, port, username, authKind, resolved, herdrPath)
    }

    private fun load(): List<ServerConnection> =
        prefs.getString("connections", null)?.let {
            runCatching { json.decodeFromString(listSerializer, it) }.getOrNull()
        } ?: emptyList()

    private fun persist() {
        prefs.edit().putString("connections", json.encodeToString(listSerializer, connections)).apply()
    }
}
