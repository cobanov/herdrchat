import ExpoModulesCore

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

    Events("onStreamLine", "onStreamEnd", "onStreamError")

    AsyncFunction("connect") { (id: String, config: SshConfigRecord) -> [String: Any] in
      do {
        let connection = await self.connections.connection(for: id, config: config)
        try await connection.connected()
        let fingerprint = await connection.acceptedFingerprint ?? ""
        return ["ok": true, "fingerprint": fingerprint]
      } catch let failure as SshFailure {
        await self.connections.drop(id)
        return ["ok": false, "code": failure.code, "message": failure.message]
      } catch {
        await self.connections.drop(id)
        return ["ok": false, "code": "connect_failed", "message": SshFailure.friendly(error)]
      }
    }

    AsyncFunction("disconnect") { (id: String) in
      await self.connections.drop(id)
    }

    AsyncFunction("exec") { (id: String, command: String) -> [String: Any] in
      guard let connection = await self.connections.existing(id) else {
        return Self.notConnected
      }
      do {
        let output = try await connection.exec(command)
        return [
          "ok": true,
          "stdout": output.stdout,
          "stderr": output.stderr,
          "exitCode": output.exitCode,
        ]
      } catch let failure as SshFailure {
        return ["ok": false, "code": failure.code, "message": failure.message]
      } catch {
        return ["ok": false, "code": "transport_failed", "message": SshFailure.friendly(error)]
      }
    }

    AsyncFunction("startStream") { (id: String, streamId: String, command: String) -> [String: Any] in
      guard let connection = await self.connections.existing(id) else {
        return Self.notConnected
      }
      do {
        let task = try await connection.startStream(
          command,
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
        return ["ok": false, "code": failure.code, "message": failure.message]
      } catch {
        return ["ok": false, "code": "transport_failed", "message": SshFailure.friendly(error)]
      }
    }

    AsyncFunction("stopStream") { (streamId: String) in
      await self.connections.stopStream(streamId)
    }

    OnDestroy {
      let store = self.connections
      Task { await store.closeAll() }
    }
  }

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

  func drop(_ id: String) async {
    guard let connection = connections.removeValue(forKey: id) else { return }
    await connection.close()
  }

  func closeAll() async {
    for task in streams.values { task.cancel() }
    streams.removeAll()
    for connection in connections.values { await connection.close() }
    connections.removeAll()
  }
}
