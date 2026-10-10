import ExpoModulesCore
import HerdrShellRegistry

/// Connection config as it arrives from JavaScript. Records flatten the TS
/// discriminated union — Expo's Record decoding has no sum type — so `authKind`
/// selects which of the optional fields is meaningful.
struct SshConfigRecord: Record {
  @Field var host: String = ""
  @Field var port: Int = 22
  @Field var username: String = ""
  @Field var authKind: String = "privateKey"
  @Field var password: String?
  @Field var privateKey: String?
  @Field var passphrase: String?
  @Field var hostKeyFingerprint: String?
}

/// SSH transport for reaching herdr hosts, as a TurboModule.
///
/// There is no maintained SSH client for React Native, so this wraps the one
/// the SwiftUI app already proved in production (Citadel / SwiftNIO SSH) and
/// exposes exactly the two operations the app needs: run a command, and follow
/// a long-lived one line by line.
///
/// Nothing here throws for an expected failure. Talking to someone else's
/// machine fails routinely — host down, key rotated, herdr not installed — and
/// each of those means something different to the user. Native returns a tagged
/// result and TypeScript owns the policy, where it can be tested.
public class HerdrSshModule: Module {
  private let connections = ConnectionStore()

  public func definition() -> ModuleDefinition {
    Name("HerdrSsh")

    Events("onStreamLine", "onStreamEnd", "onStreamError", "onShellClosed")

    AsyncFunction("connect") { (id: String, config: SshConfigRecord) -> [String: Any] in
      do {
        let connection = await self.connections.connection(for: id, config: config)
        try await connection.connected()
        let fingerprint = await connection.acceptedFingerprint ?? ""
        return ["ok": true, "fingerprint": fingerprint]
      } catch let failure as SshFailure {
        await self.connections.drop(id)
        return failureMap(failure)
      } catch {
        await self.connections.drop(id)
        return ["ok": false, "code": "connect_failed", "message": SshFailure.friendly(error)]
      }
    }

    AsyncFunction("disconnect") { (id: String) in
      await self.connections.drop(id)
    }

    AsyncFunction("exec") { (id: String, command: String, timeoutMs: Int) -> [String: Any] in
      guard let connection = await self.connections.existing(id) else {
        return Self.notConnected
      }
      do {
        let output = try await connection.exec(command, timeoutMs: timeoutMs)
        return [
          "ok": true,
          "stdout": output.stdout,
          "stderr": output.stderr,
          "exitCode": output.exitCode,
        ]
      } catch let failure as SshFailure {
        return failureMap(failure)
      } catch {
        return ["ok": false, "code": "transport_failed", "message": SshFailure.friendly(error)]
      }
    }

    AsyncFunction("startStream") {
      (id: String, streamId: String, command: String, startTimeoutMs: Int) -> [String: Any] in
      guard let connection = await self.connections.existing(id) else {
        return Self.notConnected
      }
      do {
        let task = try await connection.startStream(
          command,
          startTimeoutMs: startTimeoutMs,
          onLine: { [weak self] line in
            self?.sendEvent("onStreamLine", ["streamId": streamId, "line": line])
          },
          onEnd: { [weak self] exitCode in
            self?.sendEvent("onStreamEnd", ["streamId": streamId, "exitCode": exitCode])
            guard let store = self?.connections else { return }
            Task { await store.forgetStream(streamId) }
          },
          onError: { [weak self] code, message in
            self?.sendEvent("onStreamError", [
              "streamId": streamId, "code": code, "message": message,
            ])
            guard let store = self?.connections else { return }
            Task { await store.forgetStream(streamId) }
          }
        )
        await self.connections.registerStream(streamId, task: task)
        return ["ok": true]
      } catch let failure as SshFailure {
        return failureMap(failure)
      } catch {
        return ["ok": false, "code": "transport_failed", "message": SshFailure.friendly(error)]
      }
    }

    AsyncFunction("stopStream") { (streamId: String) in
      await self.connections.stopStream(streamId)
    }

    // MARK: Terminal shells
    //
    // A PTY shell's output never comes through here: it goes to the terminal
    // view via `ShellRegistry`, and keystrokes from the view go straight back.
    // JavaScript opens, sizes and closes the shell, writes the accessory bar's
    // keys, and hears how it ended.

    AsyncFunction("openShell") {
      (id: String, shellId: String, command: String, cols: Int, rows: Int, term: String, startTimeoutMs: Int)
        -> [String: Any] in
      let registry = ShellRegistry.shared
      if id == Self.demoConnection {
        EchoShell.open(shellId, registry: registry)
        return ["ok": true, "shellId": shellId]
      }
      guard let connection = await self.connections.existing(id) else {
        return Self.notConnected
      }
      // Registered before the channel opens, so a command that ends at once
      // unregisters after this, never before it.
      let pending = PendingShell()
      registry.register(shellId, input: ShellRegistry.Input(
        write: { data in pending.handle?.write(data) },
        resize: { cols, rows in pending.handle?.resize(cols: cols, rows: rows) }
      ))
      do {
        let handle = try await connection.openShell(
          command,
          cols: cols,
          rows: rows,
          term: term,
          startTimeoutMs: startTimeoutMs,
          onOutput: { data in registry.deliver(shellId, data) },
          onClose: { [weak self] end in
            registry.unregister(shellId)
            var event: [String: Any] = ["shellId": shellId, "reason": end.reason]
            if let code = end.exitCode { event["exitCode"] = code }
            if let message = end.message { event["message"] = message }
            self?.sendEvent("onShellClosed", event)
            guard let store = self?.connections else { return }
            Task { await store.forgetShell(shellId) }
          }
        )
        pending.handle = handle
        await self.connections.registerShell(shellId, handle: handle)
        return ["ok": true, "shellId": shellId]
      } catch let failure as SshFailure {
        registry.unregister(shellId)
        return failureMap(failure)
      } catch {
        registry.unregister(shellId)
        return ["ok": false, "code": "transport_failed", "message": SshFailure.friendly(error)]
      }
    }

    AsyncFunction("writeShell") { (shellId: String, base64: String) -> [String: Any] in
      guard let data = Data(base64Encoded: base64) else {
        return ["ok": false, "code": "bad_input", "message": "The input was not base64."]
      }
      guard ShellRegistry.shared.send(shellId, data) else { return Self.shellClosed }
      return ["ok": true]
    }

    AsyncFunction("resizeShell") { (shellId: String, cols: Int, rows: Int) -> [String: Any] in
      guard ShellRegistry.shared.resize(shellId, cols: cols, rows: rows) else { return Self.shellClosed }
      return ["ok": true]
    }

    AsyncFunction("closeShell") { (shellId: String) in
      ShellRegistry.shared.forget(shellId)
      await self.connections.closeShell(shellId)
    }

    OnDestroy {
      let store = self.connections
      Task { await store.closeAll() }
    }
  }

  /// The Demo host's connection id: `openShell` on it opens an echo shell
  /// with no SSH under it, which the Demo feeds its recorded screens to.
  static let demoConnection = "demo"

  private static let shellClosed: [String: Any] = [
    "ok": false,
    "code": "shell_closed",
    "message": "This terminal is no longer connected.",
  ]

  private static let notConnected: [String: Any] = [
    "ok": false,
    "code": "not_connected",
    "message": "No live connection for this server. Connect first.",
  ]
}

/// Owns the live connections and stream tasks. An actor because JS can call
/// `connect` for two servers, or `stopStream` while a stream is still starting,
/// concurrently.
actor ConnectionStore {
  private var connections: [String: SshConnection] = [:]
  private var streams: [String: Task<Void, Never>] = [:]
  private var shells: [String: ShellHandle] = [:]

  func connection(for id: String, config: SshConfigRecord) -> SshConnection {
    if let existing = connections[id] { return existing }
    let created = SshConnection(config: config)
    connections[id] = created
    return created
  }

  func existing(_ id: String) -> SshConnection? {
    connections[id]
  }

  func registerStream(_ streamId: String, task: Task<Void, Never>) {
    streams[streamId] = task
  }

  func forgetStream(_ streamId: String) {
    streams[streamId] = nil
  }

  func stopStream(_ streamId: String) {
    streams.removeValue(forKey: streamId)?.cancel()
  }

  func registerShell(_ shellId: String, handle: ShellHandle) {
    shells[shellId] = handle
  }

  func forgetShell(_ shellId: String) {
    shells[shellId] = nil
  }

  func closeShell(_ shellId: String) {
    shells.removeValue(forKey: shellId)?.close()
  }

  func drop(_ id: String) async {
    guard let connection = connections.removeValue(forKey: id) else { return }
    await connection.close()
  }

  func closeAll() async {
    for task in streams.values { task.cancel() }
    streams.removeAll()
    for shell in shells.values { shell.close() }
    shells.removeAll()
    for connection in connections.values { await connection.close() }
    connections.removeAll()
  }
}

/// The handle of a shell still opening. Input that arrives before it is set
/// has nowhere to go and is dropped; nothing is typed into a terminal that has
/// not drawn yet.
private final class PendingShell: @unchecked Sendable {
  private let lock = NSLock()
  private weak var _handle: ShellHandle?
  var handle: ShellHandle? {
    get { lock.lock(); defer { lock.unlock() }; return _handle }
    set { lock.lock(); _handle = newValue; lock.unlock() }
  }
}

/// A failure as JavaScript receives it; the presented fingerprint only when
/// there is one, so the shape stays what every other failure has.
func failureMap(_ failure: SshFailure) -> [String: Any] {
  var map: [String: Any] = ["ok": false, "code": failure.code, "message": failure.message]
  if let presented = failure.presentedFingerprint { map["presentedFingerprint"] = presented }
  return map
}
