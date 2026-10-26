package expo.modules.herdrssh

import android.util.Base64
import expo.modules.herdrshellregistry.EchoShell
import expo.modules.herdrshellregistry.ShellRegistry
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.bouncycastle.jce.provider.BouncyCastleProvider
import java.security.Security
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Android ships a cut-down BouncyCastle under the provider name "BC", and sshj
 * asks for "BC" by name: with Android's copy there is no X25519, no EC and no
 * SHA-256 digest, so every handshake failed with "no such algorithm: X25519
 * for provider BC" and no host could be reached (#4). The Compose app replaced
 * the provider at startup; the Expo port lost that step. Swapping in the full
 * library once, before the first connection, restores it.
 */
internal object Crypto {
  @Volatile private var installed = false

  fun ensureBouncyCastle() {
    if (installed) return
    synchronized(this) {
      if (installed) return
      Security.removeProvider(BouncyCastleProvider.PROVIDER_NAME)
      Security.addProvider(BouncyCastleProvider())
      installed = true
    }
  }
}

/**
 * Connection config as it arrives from JavaScript. Records flatten the TS
 * discriminated union — Expo's Record decoding has no sum type — so `authKind`
 * selects which of the optional fields is meaningful.
 */
class SshConfigRecord : Record {
  @Field var host: String = ""
  @Field var port: Int = 22
  @Field var username: String = ""
  @Field var authKind: String = "privateKey"
  @Field var password: String? = null
  @Field var privateKey: String? = null
  @Field var passphrase: String? = null
  @Field var hostKeyFingerprint: String? = null
}

/**
 * SSH transport for reaching herdr hosts. See `modules/herdr-ssh/README.md` for
 * why this module exists and why nothing here throws for an expected failure.
 */
class HerdrSshModule : Module() {
  private val connections = ConcurrentHashMap<String, SshConnection>()
  private val streams = ConcurrentHashMap<String, SshConnection.StreamHandle>()
  private val shells = ConcurrentHashMap<String, SshConnection.ShellHandle>()

  override fun definition() = ModuleDefinition {
    Name("HerdrSsh")

    Events("onStreamLine", "onStreamEnd", "onStreamError", "onShellClosed")

    OnCreate { Crypto.ensureBouncyCastle() }

    AsyncFunction("connect") Coroutine { id: String, config: SshConfigRecord ->
      try {
        Crypto.ensureBouncyCastle()
        val connection = connections.getOrPut(id) { SshConnection(config) }
        connection.connectWithin(CONNECT_DEADLINE_MS)
        mapOf("ok" to true, "fingerprint" to (connection.acceptedFingerprint ?: ""))
      } catch (failure: SshFailure) {
        connections.remove(id)?.close()
        failureMap(failure.code, failure.message) + (
          failure.presentedFingerprint?.let { mapOf("presentedFingerprint" to it) } ?: emptyMap()
        )
      } catch (error: Exception) {
        connections.remove(id)?.close()
        failureMap("connect_failed", error.message ?: "Couldn't reach the host.")
      }
    }

    AsyncFunction("disconnect") Coroutine { id: String ->
      connections.remove(id)?.close()
    }

    AsyncFunction("exec") Coroutine { id: String, command: String, timeoutMs: Int ->
      val connection = connections[id] ?: return@Coroutine notConnected
      try {
        val output = connection.exec(command, timeoutMs)
        mapOf(
          "ok" to true,
          "stdout" to output.stdout,
          "stderr" to output.stderr,
          "exitCode" to output.exitCode,
        )
      } catch (failure: SshFailure) {
        failureMap(failure.code, failure.message)
      } catch (error: Exception) {
        failureMap("transport_failed", error.message ?: "The connection dropped.")
      }
    }

    AsyncFunction("startStream") Coroutine {
      id: String, streamId: String, command: String, startTimeoutMs: Int ->
      val connection = connections[id] ?: return@Coroutine notConnected
      try {
        val handle = connection.startStream(
          command,
          startTimeoutMs,
          onLine = { line ->
            sendEvent("onStreamLine", mapOf("streamId" to streamId, "line" to line))
          },
          onEnd = { exitCode ->
            sendEvent("onStreamEnd", mapOf("streamId" to streamId, "exitCode" to exitCode))
            streams.remove(streamId)
          },
          onError = { code, message ->
            sendEvent(
              "onStreamError",
              mapOf("streamId" to streamId, "code" to code, "message" to message),
            )
            streams.remove(streamId)
          },
        )
        streams[streamId] = handle
        mapOf("ok" to true)
      } catch (failure: SshFailure) {
        failureMap(failure.code, failure.message)
      } catch (error: Exception) {
        failureMap("transport_failed", error.message ?: "The stream couldn't start.")
      }
    }

    AsyncFunction("stopStream") Coroutine { streamId: String ->
      streams.remove(streamId)?.stop()
    }

    // Terminal shells. A shell's output never comes through here: it goes to
    // the terminal view through `ShellRegistry`, and keystrokes come straight
    // back. JavaScript opens, sizes and closes it, writes the accessory bar's
    // keys, and hears how it ended.

    AsyncFunction("openShell") Coroutine {
      id: String, shellId: String, command: String, cols: Int, rows: Int, term: String, startTimeoutMs: Int ->
      val registry = ShellRegistry.shared
      if (id == DEMO_CONNECTION) {
        EchoShell.open(shellId, registry)
        return@Coroutine mapOf("ok" to true, "shellId" to shellId)
      }
      val connection = connections[id] ?: return@Coroutine notConnected
      // Registered before the channel opens, so a command that ends at once
      // unregisters after this, never before it.
      val pending = AtomicReference<SshConnection.ShellHandle?>()
      registry.register(shellId, ShellRegistry.Input(
        write = { pending.get()?.write(it) },
        resize = { cols, rows -> pending.get()?.resize(cols, rows) },
      ))
      try {
        val handle = connection.openShell(
          command, cols, rows, term, startTimeoutMs,
          onOutput = { registry.deliver(shellId, it) },
          onClose = { end ->
            registry.unregister(shellId)
            shells.remove(shellId)
            sendEvent(
              "onShellClosed",
              listOfNotNull(
                "shellId" to shellId,
                "reason" to end.reason,
                end.exitCode?.let { "exitCode" to it },
                end.message?.let { "message" to it },
              ).toMap(),
            )
          },
        )
        pending.set(handle)
        shells[shellId] = handle
        mapOf("ok" to true, "shellId" to shellId)
      } catch (failure: SshFailure) {
        registry.unregister(shellId)
        failureMap(failure.code, failure.message)
      } catch (error: Exception) {
        registry.unregister(shellId)
        failureMap("transport_failed", error.message ?: "The terminal couldn't open.")
      }
    }

    AsyncFunction("writeShell") { shellId: String, base64: String ->
      val data = try {
        Base64.decode(base64, Base64.DEFAULT)
      } catch (error: IllegalArgumentException) {
        return@AsyncFunction failureMap("bad_input", "The input was not base64.")
      }
      if (ShellRegistry.shared.send(shellId, data)) ok else shellClosed
    }

    AsyncFunction("resizeShell") { shellId: String, cols: Int, rows: Int ->
      if (ShellRegistry.shared.resize(shellId, cols, rows)) ok else shellClosed
    }

    AsyncFunction("closeShell") { shellId: String ->
      ShellRegistry.shared.forget(shellId)
      shells.remove(shellId)?.close()
    }

    // A line to a running stream's stdin: the host's socket bridge, which
    // stays up for the connection and takes one request a line.
    AsyncFunction("writeStream") Coroutine { streamId: String, text: String ->
      val handle = streams[streamId]
        ?: return@Coroutine failureMap("transport_failed", "That stream is no longer open.")
      try {
        withContext(Dispatchers.IO) { handle.write(text) }
        mapOf("ok" to true)
      } catch (error: Exception) {
        failureMap("transport_failed", error.message ?: "The host stopped reading.")
      }
    }

    OnDestroy {
      shells.values.forEach { it.close() }
      shells.clear()
      streams.values.forEach { it.stop() }
      streams.clear()
      // Closed, not just forgotten: clearing the map left every socket open
      // until the process died (#110).
      connections.values.forEach { it.abandon() }
      connections.clear()
    }
  }

  private companion object {
    /** The whole connect: socket, handshake and authentication. */
    const val CONNECT_DEADLINE_MS = 30_000
    /** The Demo host's connection id: `openShell` on it opens an echo shell with no SSH under it. */
    const val DEMO_CONNECTION = "demo"
  }

  private val ok = mapOf("ok" to true)

  private val shellClosed = mapOf(
    "ok" to false,
    "code" to "shell_closed",
    "message" to "This terminal is no longer connected.",
  )

  private fun failureMap(code: String, message: String) =
    mapOf("ok" to false, "code" to code, "message" to message)

  private val notConnected = mapOf(
    "ok" to false,
    "code" to "not_connected",
    "message" to "No live connection for this server. Connect first.",
  )
}
