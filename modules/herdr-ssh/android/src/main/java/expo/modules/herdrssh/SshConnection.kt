package expo.modules.herdrssh

import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.common.IOUtils
import net.schmizz.sshj.transport.verification.HostKeyVerifier
import net.schmizz.sshj.userauth.UserAuthException
import net.schmizz.sshj.userauth.password.PasswordUtils
import java.io.IOException
import java.security.MessageDigest
import java.security.PublicKey

/** A failure the caller is expected to handle. `code` matches `SshFailureCode` in TypeScript. */
class SshFailure(val code: String, override val message: String) : Exception(message)

/**
 * One long-lived SSH connection to a herdr host.
 *
 * Ported from the Compose app's `core.net.SshTransport`. The connection is
 * opened lazily and reused; a cached client is liveness-checked before use, and
 * a command that fails at the connection level drops the client, reconnects and
 * retries once — so a stale connection (network change, background suspension,
 * NAT timeout) heals transparently rather than erroring until app restart.
 */
class SshConnection(private val config: SshConfigRecord) {

  private val mutex = Mutex()
  @Volatile private var client: SSHClient? = null
  @Volatile private var hostKeyMismatch = false
  @Volatile var acceptedFingerprint: String? = null
    private set

  suspend fun connected(): SSHClient = mutex.withLock {
    client?.takeIf { it.isConnected && it.isAuthenticated }?.let { return it }
    runCatching { client?.disconnect() }
    client = null

    withContext(Dispatchers.IO) {
      hostKeyMismatch = false
      val fresh = SSHClient()
      fresh.addHostKeyVerifier(hostKeyVerifier())
      try {
        fresh.connect(config.host, config.port)
      } catch (error: Exception) {
        if (hostKeyMismatch) {
          throw SshFailure(
            "host_key_changed",
            "The server's SSH key DIFFERS from the saved one (possible MITM, or the server was reinstalled). If you trust it, edit and save the server to reset the pin.",
          )
        }
        throw SshFailure("connect_failed", error.message ?: "Couldn't reach the host.")
      }
      // Survive NAT/router idle timeouts on a long-lived connection.
      fresh.connection.keepAlive.keepAliveInterval = 20
      authenticate(fresh)
      client = fresh
      fresh
    }
  }

  /**
   * Trust-on-first-use: record the host key's SHA-256 fingerprint on first
   * contact; refuse any later connection presenting a different key.
   */
  private fun hostKeyVerifier(): HostKeyVerifier = object : HostKeyVerifier {
    override fun verify(hostname: String, port: Int, key: PublicKey): Boolean {
      val digest = MessageDigest.getInstance("SHA-256").digest(key.encoded)
      val fingerprint = Base64.encodeToString(digest, Base64.NO_WRAP)
      acceptedFingerprint = fingerprint
      val pin = config.hostKeyFingerprint?.takeIf { it.isNotEmpty() }
        ?: return true   // first contact: trust and record
      if (pin == fingerprint) return true
      hostKeyMismatch = true
      return false
    }

    override fun findExistingAlgorithms(hostname: String, port: Int): List<String> = emptyList()
  }

  private fun authenticate(client: SSHClient) {
    try {
      if (config.authKind == "password") {
        client.authPassword(config.username, config.password ?: "")
      } else {
        val passphrase = config.passphrase
          ?.takeIf { it.isNotEmpty() }
          ?.let { PasswordUtils.createOneOff(it.toCharArray()) }
        val keys = client.loadKeys(config.privateKey ?: "", null, passphrase)
        client.authPublickey(config.username, keys)
      }
    } catch (error: UserAuthException) {
      throw SshFailure(
        "auth_failed",
        "The server rejected these credentials. Check the username and the key or password.",
      )
    } catch (error: IOException) {
      throw SshFailure(
        "bad_key",
        "That private key couldn't be read. Paste the whole OpenSSH key (ed25519 or RSA), including the BEGIN/END lines, and check the passphrase.",
      )
    }
  }

  suspend fun close() = mutex.withLock {
    withContext(Dispatchers.IO) { runCatching { client?.disconnect() } }
    client = null
  }

  private suspend fun resetClient() = mutex.withLock {
    withContext(Dispatchers.IO) { runCatching { client?.disconnect() } }
    client = null
  }

  data class CommandOutput(val stdout: String, val stderr: String, val exitCode: Int)

  /**
   * Run a command to completion. A non-zero exit is a RESULT, not an error — the
   * caller decides what exit 127 means. Only connection-level failures retry.
   */
  suspend fun exec(command: String): CommandOutput =
    try {
      execOnce(command)
    } catch (failure: SshFailure) {
      throw failure   // auth / host key / bad key: retrying changes nothing
    } catch (error: IOException) {
      resetClient()
      try {
        execOnce(command)
      } catch (retry: IOException) {
        throw SshFailure("transport_failed", retry.message ?: "The connection dropped.")
      }
    }

  private suspend fun execOnce(command: String): CommandOutput = withContext(Dispatchers.IO) {
    val client = connected()
    val session = client.startSession()
    try {
      val cmd = session.exec(command)
      val stdout = IOUtils.readFully(cmd.inputStream).toString()
      val stderr = IOUtils.readFully(cmd.errorStream).toString()
      cmd.join()
      CommandOutput(stdout, stderr, cmd.exitStatus ?: 0)
    } finally {
      runCatching { session.close() }
    }
  }

  /**
   * Run a long-lived command and hand each stdout LINE to [onLine]. Returns a
   * handle whose `stop()` unblocks the parked reader and closes the channel.
   */
  suspend fun startStream(
    command: String,
    onLine: (String) -> Unit,
    onEnd: (Int) -> Unit,
    onError: (String, String) -> Unit,
  ): StreamHandle {
    val client = try {
      connected()
    } catch (failure: SshFailure) {
      throw failure
    } catch (error: IOException) {
      resetClient()
      connected()
    }

    return withContext(Dispatchers.IO) {
      val session = client.startSession()
      val cmd = session.exec(command)
      val reader = cmd.inputStream.bufferedReader()
      val handle = StreamHandle(session)
      Thread {
        try {
          while (!handle.stopped) {
            val line = reader.readLine() ?: break
            onLine(line)
          }
          if (!handle.stopped) onEnd(cmd.exitStatus ?: 0)
        } catch (error: Exception) {
          if (!handle.stopped) {
            onError("transport_failed", error.message ?: "The stream ended unexpectedly.")
          }
        } finally {
          runCatching { session.close() }
        }
      }.apply { isDaemon = true }.start()
      handle
    }
  }

  class StreamHandle(private val session: net.schmizz.sshj.connection.channel.direct.Session) {
    @Volatile var stopped = false
      private set

    /** Closing the session is what unblocks a `readLine()` parked on the channel. */
    fun stop() {
      stopped = true
      runCatching { session.close() }
    }
  }
}
