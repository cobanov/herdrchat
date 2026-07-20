package dev.herdr.herdrchat.core.net

import android.util.Base64
import dev.herdr.herdrchat.core.model.HerdrException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.common.IOUtils
import net.schmizz.sshj.transport.verification.HostKeyVerifier
import net.schmizz.sshj.transport.verification.PromiscuousVerifier
import net.schmizz.sshj.userauth.password.PasswordUtils
import java.io.IOException
import java.security.MessageDigest
import java.security.PublicKey

/**
 * A [HerdrTransport] that runs commands on a remote herdr host over SSH. The
 * connection is opened lazily and reused; a cached client is liveness-checked
 * before use, and a command that fails at the connection level drops the
 * client, reconnects, and retries once — so a stale connection (network change,
 * background suspension, NAT timeout) heals transparently.
 */
class SshTransport(private val config: SshConfig) : HerdrTransport {

    private val mutex = Mutex()
    @Volatile private var client: SSHClient? = null
    @Volatile private var hostKeyMismatch = false

    private suspend fun connected(): SSHClient = mutex.withLock {
        client?.takeIf { it.isConnected && it.isAuthenticated }?.let { return it }
        client?.let { runCatching { it.disconnect() } }
        client = null
        withContext(Dispatchers.IO) {
            hostKeyMismatch = false
            val c = SSHClient()
            c.addHostKeyVerifier(hostKeyVerifier())
            try {
                c.connect(config.host, config.port)
            } catch (e: Exception) {
                if (hostKeyMismatch) {
                    throw HerdrException(
                        "host_key_changed",
                        "The server's SSH key DIFFERS from the saved one (possible MITM, or the server was reinstalled). If you trust it, edit and save the server to reset the pin.",
                    )
                }
                throw e
            }
            // Survive NAT/router idle timeouts on a long-lived connection.
            c.connection.keepAlive.keepAliveInterval = 20
            authenticate(c)
            client = c
            c
        }
    }

    /** Trust-on-first-use: pin the host key's SHA-256 fingerprint on first
     *  contact; refuse any later connection presenting a different key. */
    private fun hostKeyVerifier(): HostKeyVerifier {
        val pin = config.hostKeyPin ?: return PromiscuousVerifier()
        return object : HostKeyVerifier {
            override fun verify(hostname: String, port: Int, key: PublicKey): Boolean {
                val digest = MessageDigest.getInstance("SHA-256").digest(key.encoded)
                val fingerprint = Base64.encodeToString(digest, Base64.NO_WRAP)
                val stored = pin.load()
                return when {
                    stored == null -> { pin.save(fingerprint); true }   // first contact
                    stored == fingerprint -> true
                    else -> { hostKeyMismatch = true; false }
                }
            }

            override fun findExistingAlgorithms(hostname: String, port: Int): List<String> = emptyList()
        }
    }

    private fun authenticate(c: SSHClient) {
        when (val a = config.auth) {
            is SshAuth.Password -> c.authPassword(config.username, a.password)
            is SshAuth.PrivateKey -> {
                val pwd = a.passphrase?.let { PasswordUtils.createOneOff(it.toCharArray()) }
                val keys = c.loadKeys(a.pem, null, pwd)   // OpenSSH ed25519 or RSA
                c.authPublickey(config.username, keys)
            }
        }
    }

    suspend fun disconnect() = mutex.withLock {
        withContext(Dispatchers.IO) { runCatching { client?.disconnect() } }
        client = null
    }

    private suspend fun resetClient() = mutex.withLock {
        withContext(Dispatchers.IO) { runCatching { client?.disconnect() } }
        client = null
    }

    // Non-interactive SSH shells don't load the user's profile, so herdr's
    // install dir (~/.local/bin, Homebrew) usually isn't on PATH and `herdr`
    // resolves to command-not-found (exit 127). We set a COMPLETE PATH with the
    // standard system dirs spelled out rather than trusting the inherited $PATH:
    // zsh sources .zshenv on every exec (full PATH), but a `sh` login shell
    // sources nothing non-interactively and may inherit only a minimal PATH from
    // sshd — which broke connecting for sh users (even ls/tail could be missing).
    private fun withPath(command: String): String =
        "export PATH=\"\$HOME/.local/bin:\$HOME/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:\$PATH\"; $command"

    private suspend fun execOnce(command: String): String = withContext(Dispatchers.IO) {
        val c = connected()
        val session = c.startSession()
        try {
            val cmd = session.exec(withPath(command))
            val out = IOUtils.readFully(cmd.inputStream).toByteArray().toString(Charsets.UTF_8)
            cmd.join()
            val code = cmd.exitStatus
            if (code != null && code != 0) {
                // Exit 127 = "command not found": for us that almost always means
                // herdr isn't installed for this account (or isn't on PATH).
                if (code == 127) {
                    throw HerdrException(
                        "herdr_not_found",
                        "herdr wasn't found on this account (exit 127). It's likely not installed for this user, or not on PATH. Install herdr on the host, or set its full path in the connection's Advanced settings.",
                    )
                }
                throw HerdrException("ssh_command_failed", "The command failed on the host (exit $code).")
            }
            out
        } finally {
            runCatching { session.close() }
        }
    }

    override suspend fun shell(command: String): String =
        try {
            execOnce(command)
        } catch (e: HerdrException) {
            throw e   // command ran (non-zero exit) or host-key refusal: no retry
        } catch (e: IOException) {
            // Connection-level failure: rebuild the connection and retry once.
            resetClient()
            execOnce(command)
        }

    override fun streamLines(command: String): Flow<String> = callbackFlow {
        // Establish (or heal) the connection with one retry, then stream.
        val c = try {
            connected()
        } catch (e: HerdrException) {
            throw e
        } catch (e: IOException) {
            resetClient()
            connected()
        }
        val session = c.startSession()
        val cmd = session.exec(withPath(command))
        val reader = cmd.inputStream.bufferedReader()
        val job = launch(Dispatchers.IO) {
            try {
                while (isActive) {
                    val line = reader.readLine() ?: break
                    trySend(line)
                }
                close()
            } catch (e: Exception) {
                close(e)
            }
        }
        awaitClose {
            job.cancel()
            runCatching { session.close() }   // unblocks a parked readLine()
        }
    }.flowOn(Dispatchers.IO)
}
