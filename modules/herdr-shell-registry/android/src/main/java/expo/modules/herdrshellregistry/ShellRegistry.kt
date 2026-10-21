package expo.modules.herdrshellregistry

import android.os.Handler
import android.os.Looper
import java.util.UUID

/**
 * The meeting point between a shell channel and the terminal view showing it,
 * the Android twin of `ios/ShellRegistry.swift` (see the README).
 *
 * `herdr-ssh` registers each open shell's input here and delivers its output;
 * `herdr-terminal`'s view attaches a sink for the output and sends keystrokes
 * and sizes back. Output that arrives before a view attaches is held (bounded)
 * and handed over on attach. Sinks run on [post]'s thread, the main one in the
 * app, in the order the bytes arrived.
 */
class ShellRegistry(private val post: (Runnable) -> Unit = mainThread()) {
  /** What a shell accepts from its view. */
  class Input(val write: (ByteArray) -> Unit, val resize: (cols: Int, rows: Int) -> Unit)

  private class Sink(val token: UUID, val receive: (ByteArray) -> Unit)

  private val lock = Any()
  private val inputs = HashMap<String, Input>()
  private val sinks = HashMap<String, Sink>()
  private val backlogs = HashMap<String, ByteArray>()

  // The shell's side

  fun register(shellId: String, input: Input) = synchronized(lock) { inputs[shellId] = input }

  /** The shell ended. Its view keeps its scrollback; held output waits for a view still to come. */
  fun unregister(shellId: String) = synchronized(lock) { inputs.remove(shellId) }

  /** Drop everything about a shell: the app closed it. */
  fun forget(shellId: String) = synchronized(lock) {
    inputs.remove(shellId)
    backlogs.remove(shellId)
  }

  /**
   * Output for the view, from any thread. With no view attached it is held,
   * but only for a shell still registered: a channel's last chunks after
   * `forget` would otherwise sit under an id nobody attaches to again.
   */
  fun deliver(shellId: String, data: ByteArray) {
    if (data.isEmpty()) return
    synchronized(lock) {
      val sink = sinks[shellId]
      if (sink != null) {
        // Posted under the lock, so two deliveries can never reorder.
        post(Runnable { sink.receive(data) })
        return
      }
      if (!inputs.containsKey(shellId)) return
      val held = (backlogs[shellId] ?: ByteArray(0)) + data
      backlogs[shellId] = if (held.size > MAX_BACKLOG_BYTES) held.copyOfRange(held.size - MAX_BACKLOG_BYTES, held.size) else held
    }
  }

  // The view's side

  /** Start receiving; held output reaches [receive] before this returns. Call on [post]'s thread. */
  fun attach(shellId: String, receive: (ByteArray) -> Unit): UUID {
    val token = UUID.randomUUID()
    val held = synchronized(lock) {
      sinks[shellId] = Sink(token, receive)
      backlogs.remove(shellId)
    }
    held?.let(receive)
    return token
  }

  /** A token from an older attach is ignored, so a view being replaced cannot detach its successor. */
  fun detach(shellId: String, token: UUID) = synchronized(lock) {
    if (sinks[shellId]?.token == token) sinks.remove(shellId)
  }

  /** Keystrokes from the view. False when the shell is no longer open. */
  fun send(shellId: String, data: ByteArray): Boolean {
    val input = synchronized(lock) { inputs[shellId] } ?: return false
    input.write(data)
    return true
  }

  fun resize(shellId: String, cols: Int, rows: Int): Boolean {
    if (cols <= 0 || rows <= 0) return false
    val input = synchronized(lock) { inputs[shellId] } ?: return false
    input.resize(cols, rows)
    return true
  }

  fun isOpen(shellId: String): Boolean = synchronized(lock) { inputs.containsKey(shellId) }

  companion object {
    /** Past this the oldest held bytes go: a view that never comes must not grow memory without end. */
    const val MAX_BACKLOG_BYTES = 2 * 1024 * 1024

    val shared by lazy { ShellRegistry() }

    private fun mainThread(): (Runnable) -> Unit {
      val handler by lazy { Handler(Looper.getMainLooper()) }
      return { handler.post(it) }
    }
  }
}

/**
 * The Demo's shell: no host, no channel. What is typed comes straight back,
 * as a terminal in cooked mode echoes it; the Demo feeds its recorded screens
 * with `deliver`.
 */
object EchoShell {
  fun open(shellId: String, registry: ShellRegistry = ShellRegistry.shared) {
    registry.register(shellId, ShellRegistry.Input(
      write = { registry.deliver(shellId, cooked(it)) },
      resize = { _, _ -> },
    ))
  }

  /** Return as a new line, Delete as erase-one-back; everything else as typed. */
  fun cooked(data: ByteArray): ByteArray {
    val out = ArrayList<Byte>(data.size)
    for (byte in data) {
      when (byte.toInt()) {
        0x0D -> out += listOf(0x0D, 0x0A).map(Int::toByte)
        0x7F, 0x08 -> out += listOf(0x08, 0x20, 0x08).map(Int::toByte)
        else -> out += byte
      }
    }
    return out.toByteArray()
  }
}
