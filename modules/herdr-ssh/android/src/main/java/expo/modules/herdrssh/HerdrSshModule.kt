package expo.modules.herdrssh

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.bouncycastle.jce.provider.BouncyCastleProvider
import java.security.Security
import java.util.concurrent.ConcurrentHashMap

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

  override fun definition() = ModuleDefinition {
    Name("HerdrSsh")

    Events("onStreamLine", "onStreamEnd", "onStreamError")

    OnCreate { Crypto.ensureBouncyCastle() }

    AsyncFunction("connect") Coroutine { id: String, config: SshConfigRecord ->
      try {
        Crypto.ensureBouncyCastle()
        val connection = connections.getOrPut(id) { SshConnection(config) }
        connection.connected()
        mapOf("ok" to true, "fingerprint" to (connection.acceptedFingerprint ?: ""))
      } catch (failure: SshFailure) {
        connections.remove(id)?.close()
        failureMap(failure.code, failure.message)
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

    OnDestroy {
      streams.values.forEach { it.stop() }
      streams.clear()
      // Closed, not just forgotten: clearing the map left every socket open
      // until the process died (#110).
      connections.values.forEach { it.abandon() }
      connections.clear()
    }
  }

  private fun failureMap(code: String, message: String) =
    mapOf("ok" to false, "code" to code, "message" to message)

  private val notConnected = mapOf(
    "ok" to false,
    "code" to "not_connected",
    "message" to "No live connection for this server. Connect first.",
  )
}
