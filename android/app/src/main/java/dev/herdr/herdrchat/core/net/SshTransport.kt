package dev.herdr.herdrchat.core.net

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
import net.schmizz.sshj.transport.verification.PromiscuousVerifier
import net.schmizz.sshj.userauth.password.PasswordUtils

/**
 * A [HerdrTransport] that runs commands on a remote herdr host over SSH. Pointed
 * at a Tailscale address, so there is no public network surface. The connection
 * is opened lazily and reused across commands (SSH handshakes are expensive
 * relative to the short `herdr` invocations we make).
 */
class SshTransport(private val config: SshConfig) : HerdrTransport {

    private val mutex = Mutex()
    @Volatile private var client: SSHClient? = null

    private suspend fun connected(): SSHClient = mutex.withLock {
        client?.takeIf { it.isConnected && it.isAuthenticated }?.let { return it }
        withContext(Dispatchers.IO) {
            val c = SSHClient()
            c.addHostKeyVerifier(PromiscuousVerifier())   // tailnet peer; no PKI needed
            c.connect(config.host, config.port)
            authenticate(c)
            client = c
            c
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

    // Non-interactive SSH shells don't load the user's profile, so herdr's
    // install dir (~/.local/bin, Homebrew) usually isn't on PATH and `herdr`
    // resolves to command-not-found (exit 127). Prepend the common bin dirs so
    // the default `herdr` just works without the user hard-coding a path.
    private fun withPath(command: String): String =
        "export PATH=\"\$HOME/.local/bin:\$HOME/bin:/opt/homebrew/bin:/usr/local/bin:\$PATH\"; $command"

    override suspend fun shell(command: String): String = withContext(Dispatchers.IO) {
        val c = connected()
        val session = c.startSession()
        try {
            val cmd = session.exec(withPath(command))
            val out = IOUtils.readFully(cmd.inputStream).toByteArray().toString(Charsets.UTF_8)
            cmd.join()
            val code = cmd.exitStatus
            if (code != null && code != 0) {
                throw HerdrException("ssh_command_failed", "exit status $code")
            }
            out
        } finally {
            runCatching { session.close() }
        }
    }

    override fun streamLines(command: String): Flow<String> = callbackFlow {
        val c = connected()
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
