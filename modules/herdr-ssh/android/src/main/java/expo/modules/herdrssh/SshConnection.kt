package expo.modules.herdrssh

import android.util.Base64
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.common.Buffer
import net.schmizz.sshj.common.IOUtils
import net.schmizz.sshj.transport.verification.HostKeyVerifier
import net.schmizz.sshj.userauth.UserAuthException
import net.schmizz.sshj.userauth.password.PasswordUtils
import java.io.IOException
import java.security.MessageDigest
import java.security.PublicKey

/** A failure the caller is expected to handle. `code` matches `SshFailureCode` in TypeScript. */
class SshFailure(
  val code: String,
  override val message: String,
  /** On `host_key_changed`: the fingerprint the host presented instead of the pin. */
  val presentedFingerprint: String? = null,
) : Exception(message)

/**
 * One long-lived SSH connection to a herdr host.
 *
 * Ported from the Compose app's `core.net.SshTransport`. The connection is
 * opened lazily and reused; a cached client is liveness-checked before use, and
 * a command that fails at the connection level drops the client. The next call
 * reconnects, but a possibly applied command is never automatically replayed.
 */
class SshConnection(private val config: SshConfigRecord) {

  private val mutex = Mutex()
  @Volatile private var client: SSHClient? = null
  /** The client being dialled, so a deadline can close it without the mutex. */
  @Volatile private var dialing: SSHClient? = null
  @Volatile private var hostKeyMismatch = false
  @Volatile private var presentedFingerprint: String? = null
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
      // Bounds the TCP handshake itself, which `connect` from JavaScript calls
      // with no deadline of its own. Not `fresh.timeout`: that is SO_TIMEOUT on
      // the socket, and sshj's reader would give up on a quiet `tail -f`.
      fresh.connectTimeout = CONNECT_TIMEOUT_MS
      dialing = fresh
      try {
        fresh.connect(config.host, config.port)
        // Survive NAT/router idle timeouts on a long-lived connection.
        fresh.connection.keepAlive.keepAliveInterval = 20
        authenticate(fresh)
        client = fresh
        fresh
      } catch (error: Exception) {
        runCatching { fresh.disconnect() }
        if (hostKeyMismatch) {
          throw SshFailure(
            "host_key_changed",
            "This host's SSH key has changed since you saved it.",
            presentedFingerprint,
          )
        }
        if (error is SshFailure) throw error
        throw SshFailure("connect_failed", error.message ?: "Couldn't reach the host.")
      } finally {
        dialing = null
      }
    }
  }

  /**
   * Trust-on-first-use: record the host key's SHA-256 fingerprint on first
   * contact; refuse any later connection presenting a different key.
   */
  private fun hostKeyVerifier(): HostKeyVerifier = object : HostKeyVerifier {
    override fun verify(hostname: String, port: Int, key: PublicKey): Boolean {
      // The SSH WIRE encoding of the key, not `key.encoded` — that is X.509
      // SPKI DER, a different blob, so it hashed to a fingerprint no other SSH
      // tool would ever print. OpenSSH's form is unpadded base64 of SHA-256
      // over the wire blob, which is what `ssh-keygen -lf` shows and what iOS
      // reports.
      val wire = Buffer.PlainBuffer().putPublicKey(key).compactData
      val digest = MessageDigest.getInstance("SHA-256").digest(wire)
      val fingerprint = Base64.encodeToString(digest, Base64.NO_WRAP).trimEnd('=')
      val pin = config.hostKeyFingerprint?.takeIf { it.isNotEmpty() } ?: acceptedFingerprint
      // Recorded only on acceptance. Assigning before the comparison published
      // a REJECTED key as the one we accepted, which is exactly the key a
      // "trust the new key" flow must never be handed for free.
      if (pin == null || pin == fingerprint) {
        acceptedFingerprint = fingerprint
        return true   // no pin: first contact, trust and record
      }
      hostKeyMismatch = true
      presentedFingerprint = fingerprint
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

  /**
   * Connect within a deadline. `connectTimeout` bounds only opening the socket;
   * a host that accepts TCP and then says nothing (not an SSH server, or a
   * wedged one) held the handshake, and Test connection with it, until the host
   * closed the socket, minutes later (#4 acceptance).
   */
  suspend fun connectWithin(timeoutMs: Int): SSHClient = withDeadline(timeoutMs) { connected() }

  suspend fun close() = mutex.withLock {
    withContext(Dispatchers.IO) { runCatching { client?.disconnect() } }
    client = null
  }

  private suspend fun resetClient() = mutex.withLock {
    withContext(Dispatchers.IO) { runCatching { client?.disconnect() } }
    client = null
  }

  /**
   * Drop the connection WITHOUT the mutex, for when something is stuck on it.
   *
   * `connected()` holds the mutex for as long as a dial takes, so a deadline
   * that waited for it would wait on the very thing that timed out. Closing
   * the socket is also what makes a read parked on it throw, which is the only
   * way to stop one: sshj's blocking reads ignore coroutine cancellation.
   * Also the module's teardown, which cannot suspend.
   */
  fun abandon() {
    val stuck = listOfNotNull(client, dialing)
    client = null
    dialing = null
    // Off the caller's thread: disconnect() writes a goodbye first, and a
    // write on a half-open socket can block too.
    if (stuck.isNotEmpty()) ioScope.launch { stuck.forEach { runCatching { it.disconnect() } } }
  }

  data class CommandOutput(val stdout: String, val stderr: String, val exitCode: Int)

  /**
   * Run once. A non-zero exit is a result. A lost reply is ambiguous, not
   * permission to execute a possibly applied command a second time.
   */
  suspend fun exec(command: String, timeoutMs: Int): CommandOutput =
    try {
      withDeadline(timeoutMs) { execOnce(command) }
    } catch (failure: SshFailure) {
      throw failure   // auth / host key / bad key / timeout: retrying changes nothing
    } catch (error: IOException) {
      resetClient()
      throw SshFailure("transport_failed", error.message ?: "The connection dropped.")
    }

  /**
   * Race an operation against its deadline.
   *
   * `withTimeout` alone was no deadline at all (#110): cancellation is
   * cooperative, sshj's reads block, and `withTimeout` waits for its block to
   * finish before throwing, so a read on a half-open socket held the command
   * forever. The operation now runs detached and only the WAIT is timed; on
   * expiry the connection is abandoned, which closes the socket under the
   * parked read so it fails and ends on its own. The next command dials fresh
   * rather than queueing behind a channel that will never answer.
   */
  private suspend fun <T> withDeadline(timeoutMs: Int, operation: suspend () -> T): T {
    if (timeoutMs <= 0) return operation()
    val work = ioScope.async { operation() }
    val outcome: Result<T>? = withTimeoutOrNull(timeoutMs.toLong()) {
      try {
        Result.success(work.await())
      } catch (cancelled: CancellationException) {
        throw cancelled
      } catch (error: Throwable) {
        Result.failure(error)
      }
    }
    if (outcome == null) {
      abandon()
      work.cancel()
      throw SshFailure(
        "timeout",
        "The host didn't answer in time. Check that it's awake and on the tailnet.",
      )
    }
    return outcome.getOrThrow()
  }

  private suspend fun execOnce(command: String): CommandOutput = withContext(Dispatchers.IO) {
    val client = connected()
    val session = client.startSession()
    try {
      val cmd = session.exec(command)
      // Both streams at once. Reading all of stdout before any of stderr
      // deadlocked a command that wrote enough to stderr to fill the channel's
      // window: it waited for stderr to drain, we waited for stdout to end.
      coroutineScope {
        val stderr = async(Dispatchers.IO) { IOUtils.readFully(cmd.errorStream).toString(Charsets.UTF_8.name()) }
        val stdout = IOUtils.readFully(cmd.inputStream).toString(Charsets.UTF_8.name())
        cmd.join()
        CommandOutput(stdout, stderr.await(), cmd.exitStatus ?: 0)
      }
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
    startTimeoutMs: Int,
    onLine: (String) -> Unit,
    onEnd: (Int) -> Unit,
    onError: (String, String) -> Unit,
  ): StreamHandle {
    // Only STARTING is bounded. What follows is a `tail -f` and is meant to
    // outlive any deadline; a stream that dies quietly is the tail watchdog's
    // job, not this one's.
    // Opening the channel is bounded too: it is a round-trip on a connection
    // that may have died since the last command.
    val (session, cmd) = withDeadline(startTimeoutMs) {
      val client = try {
        connected()
      } catch (failure: SshFailure) {
        throw failure
      } catch (error: IOException) {
        resetClient()
        connected()
      }
      val session = client.startSession()
      try {
        session to session.exec(command)
      } catch (error: Exception) {
        // The channel was open; without this it stayed open for the life of
        // the connection (#110).
        runCatching { session.close() }
        throw error
      }
    }

    return withContext(Dispatchers.IO) {
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

  private companion object {
    const val CONNECT_TIMEOUT_MS = 15_000
    /** Detached work for deadlines and teardown; never waited on by structure. */
    val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  }

  class StreamHandle(private val session: net.schmizz.sshj.connection.channel.direct.Session) {
    @Volatile var stopped = false
      private set

    /**
     * Closing the session is what unblocks a `readLine()` parked on the channel.
     *
     * Off the caller's thread: sshj's close waits for the host to close its side,
     * and the caller is Expo's single queue for every async call of this module,
     * so a close that took 30 s held up every SSH call behind it (#4). The host
     * now ends the command when the channel closes (`untilChannelCloses`), which
     * keeps that wait short, but nothing should wait on it here.
     */
    fun stop() {
      stopped = true
      Thread { runCatching { session.close() } }.apply { isDaemon = true }.start()
    }
  }
}
