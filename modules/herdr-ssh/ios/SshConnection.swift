import Foundation
import Citadel
import Crypto
import NIOCore
import NIOSSH
import Network

/// A connection failure the caller is expected to handle rather than crash on.
/// Mirrors `SshFailureCode` in the TypeScript types — the string is the wire
/// contract between the two.
struct SshFailure: Error {
  let code: String
  let message: String

  static func connect(_ error: Error) -> SshFailure {
    // Citadel surfaces auth rejection as an authentication error and everything
    // else (DNS, refused, timeout) as a channel/IO error. The distinction
    // matters to the user: "wrong key" and "host unreachable" need different
    // fixes.
    let text = String(describing: error)
    if text.contains("authenticationFailed") || text.contains("allAuthenticationOptionsFailed") {
      return SshFailure(
        code: "auth_failed",
        message: "The server rejected these credentials. Check the username and the key or password."
      )
    }
    return SshFailure(code: "connect_failed", message: friendly(error))
  }

  static func friendly(_ error: Error) -> String {
    if let failure = error as? SshFailure { return failure.message }
    return (error as NSError).localizedDescription
  }
}

/// One long-lived SSH connection to a herdr host.
///
/// Ported from the SwiftUI app's `HerdrNet.SSHTransport`, which earned every one
/// of these behaviours in the field: the connection is opened lazily and reused
/// across commands, a cached client is liveness-checked before use, a command
/// that fails at the connection level drops the client without replaying a
/// possibly applied command, and the network path is
/// watched so a route change (wifi↔cellular, Tailscale up/down) invalidates the
/// socket instead of stalling on a dead one.
///
/// There is deliberately no SSH-level keepalive here, unlike the Kotlin side
/// which sets `keepAliveInterval = 20`: Citadel exposes no equivalent on
/// `SSHClientSettings`, so there is nothing to set. The path monitor above
/// covers a route change, and `isConnected` covers a client that noticed its own
/// death — but neither catches a channel silently dropped by a NAT idle timeout
/// on an unchanged route. Two things cover that, at two different layers:
///
/// `exec` carries a deadline (see `withDeadline`). Without one, a half-open
/// socket left the command pending forever, and because the app's poll loops
/// re-arm inside a `finally`, forever meant the loop stopped and the screen
/// froze holding stale data with no error shown.
///
/// A live `tail -f` cannot have an overall deadline — being long-lived is the
/// point — so it is covered instead by the tail watchdog in `useThread`, which
/// restarts a stream that has gone quiet while its agent is working. Only the
/// bounded part, getting the command started, has a deadline here.
actor SshConnection {
  private let config: SshConfigRecord
  private var client: SSHClient?
  /// The host key fingerprint this connection accepted, reported back to JS so
  /// first contact can be persisted as the pin.
  private let hostKeyPin: HostKeyPin
  var acceptedFingerprint: String? { hostKeyPin.fingerprint }

  private let pathMonitor = NWPathMonitor()
  private var pathMonitorStarted = false
  private var pathSignature: String?

  init(config: SshConfigRecord) {
    self.config = config
    self.hostKeyPin = HostKeyPin(config.hostKeyFingerprint)
  }

  // MARK: - Lifecycle

  func close() async {
    if let client { try? await client.close() }
    client = nil
    if pathMonitorStarted {
      pathMonitor.cancel()
      pathMonitorStarted = false
    }
  }

  private func resetClient() async {
    if let client { try? await client.close() }
    client = nil
  }

  /// Watch the network path: when the interface set changes, drop the cached
  /// client so the next command dials fresh on the new route rather than
  /// stalling on a now-dead socket.
  private func startPathMonitorIfNeeded() {
    guard !pathMonitorStarted else { return }
    pathMonitorStarted = true
    pathMonitor.pathUpdateHandler = { [weak self] path in
      let signature = "\(path.status)|" + path.availableInterfaces
        .map { "\($0.type)" }.sorted().joined(separator: ",")
      Task { await self?.pathChanged(to: signature) }
    }
    pathMonitor.start(queue: DispatchQueue(label: "dev.herdr.ssh.path"))
  }

  private func pathChanged(to signature: String) async {
    let previous = pathSignature
    pathSignature = signature
    if let previous, previous != signature {
      await resetClient()
    }
  }

  // MARK: - Connecting

  @discardableResult
  func connected() async throws -> SSHClient {
    startPathMonitorIfNeeded()
    // A dead cached client (dropped TCP) must not be reused.
    if let client {
      if client.isConnected { return client }
      await resetClient()
    }

    // Parse the key up front: the settings closure below cannot throw.
    // SSHAuthenticationMethod isn't Sendable but is effectively immutable once
    // built, so the capture is safe.
    nonisolated(unsafe) let auth = try Self.authMethod(for: config)
    let observer = HostKeyObserver(pin: hostKeyPin)

    let settings = SSHClientSettings(
      host: config.host,
      port: config.port,
      authenticationMethod: { auth },
      hostKeyValidator: .custom(TOFUHostKeyDelegate(observer: observer))
    )

    do {
      let newClient = try await SSHClient.connect(to: settings)
      client = newClient
      return newClient
    } catch {
      if observer.mismatched {
        throw SshFailure(
          code: "host_key_changed",
          message: "The server's SSH key DIFFERS from the saved one (possible MITM, or the server was reinstalled). If you trust it, edit and save the server to reset the pin."
        )
      }
      throw SshFailure.connect(error)
    }
  }

  private static func authMethod(for config: SshConfigRecord) throws -> SSHAuthenticationMethod {
    if config.authKind == "password" {
      return .passwordBased(username: config.username, password: config.password ?? "")
    }
    let pem = config.privateKey ?? ""
    let decryptionKey = config.passphrase.flatMap { $0.isEmpty ? nil : $0.data(using: .utf8) }
    // ed25519 is the modern default; fall back to RSA for older keys.
    if let key = try? Curve25519.Signing.PrivateKey(sshEd25519: pem, decryptionKey: decryptionKey) {
      return .ed25519(username: config.username, privateKey: key)
    }
    do {
      let rsa = try Insecure.RSA.PrivateKey(sshRsa: pem, decryptionKey: decryptionKey)
      return .rsa(username: config.username, privateKey: rsa)
    } catch {
      throw SshFailure(
        code: "bad_key",
        message: "That private key couldn't be read. Paste the whole OpenSSH key (ed25519 or RSA), including the BEGIN/END lines, and check the passphrase."
      )
    }
  }

  // MARK: - Host key pinning (TOFU)

  /// Written once on the SSH event loop during the handshake, read after
  /// `connect` returns or throws.
  private final class HostKeyObserver: @unchecked Sendable {
    let pin: HostKeyPin
    var mismatched = false

    init(pin: HostKeyPin) {
      self.pin = pin
    }
  }

  /// Trust-on-first-use: record the host key's SHA-256 fingerprint on first
  /// contact; refuse any later connection presenting a different key.
  private final class TOFUHostKeyDelegate: NIOSSHClientServerAuthenticationDelegate, @unchecked Sendable {
    private let observer: HostKeyObserver

    init(observer: HostKeyObserver) {
      self.observer = observer
    }

    func validateHostKey(hostKey: NIOSSHPublicKey, validationCompletePromise: EventLoopPromise<Void>) {
      var buffer = ByteBuffer()
      _ = hostKey.write(to: &buffer)
      let digest = SHA256.hash(data: Data(buffer.readableBytesView))
      // OpenSSH's format: unpadded base64 of SHA-256 over the wire encoding of
      // the key. Dropping the "=" is what makes this string equal to what
      // `ssh-keygen -lf` prints, so the two can be compared by eye.
      let fingerprint = Data(digest).base64EncodedString().replacingOccurrences(of: "=", with: "")
      if observer.pin.accept(fingerprint) {
        validationCompletePromise.succeed(())
      } else {
        observer.mismatched = true
        validationCompletePromise.fail(
          SshFailure(code: "host_key_changed", message: "host key fingerprint mismatch")
        )
      }
    }
  }

  // MARK: - Commands

  struct CommandOutput {
    let stdout: String
    let stderr: String
    let exitCode: Int
  }

  /// Run a command to completion. A non-zero exit is a RESULT, not an error:
  /// the caller decides what exit 127 means. Never replay a failed command:
  /// the host may have applied it before its reply was lost.
  func exec(_ command: String, timeoutMs: Int) async throws -> CommandOutput {
    do {
      return try await withDeadline(timeoutMs) { try await self.execOnce(command) }
    } catch let failure as SshFailure {
      if failure.code == "transport_failed" { await resetClient() }
      throw failure
    } catch {
      await resetClient()
      throw SshFailure(code: "transport_failed", message: SshFailure.friendly(error))
    }
  }

  /// Race an operation against its deadline.
  ///
  /// The losing task is cancelled, but a Citadel channel blocked on a half-open
  /// socket will not necessarily notice — so the client is dropped as well. The
  /// next command dials fresh rather than queueing behind a channel that is
  /// never going to answer.
  private func withDeadline<T: Sendable>(
    _ timeoutMs: Int,
    _ operation: @escaping @Sendable () async throws -> T
  ) async throws -> T {
    guard timeoutMs > 0 else { return try await operation() }
    do {
      return try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await operation() }
        group.addTask {
          try await Task.sleep(nanoseconds: UInt64(timeoutMs) * 1_000_000)
          throw SshFailure(
            code: "timeout",
            message: "The host didn't answer in time. Check that it's awake and on the tailnet."
          )
        }
        guard let first = try await group.next() else {
          throw SshFailure(code: "transport_failed", message: "The command produced no result.")
        }
        group.cancelAll()
        return first
      }
    } catch let failure as SshFailure where failure.code == "timeout" {
      await resetClient()
      throw failure
    }
  }

  private func execOnce(_ command: String) async throws -> CommandOutput {
    let client = try await connected()
    var stdout = ByteBuffer()
    var stderr = ByteBuffer()
    do {
      let stream = try await client.executeCommandStream(command)
      for try await chunk in stream {
        switch chunk {
        case .stdout(let buffer): stdout.writeImmutableBuffer(buffer)
        case .stderr(let buffer): stderr.writeImmutableBuffer(buffer)
        }
      }
      return CommandOutput(stdout: string(stdout), stderr: string(stderr), exitCode: 0)
    } catch let failed as SSHClient.CommandFailed {
      // The command ran and exited non-zero. That is an answer, and the output
      // it produced before exiting is part of it.
      return CommandOutput(stdout: string(stdout), stderr: string(stderr), exitCode: failed.exitCode)
    } catch let failure as SshFailure {
      throw failure
    } catch {
      throw SshFailure(code: "transport_failed", message: SshFailure.friendly(error))
    }
  }

  /// Run a long-lived command and hand each stdout LINE to `onLine`, then call
  /// `onEnd` (exit code) or `onError`. Returns once the command has started, so
  /// the caller can report a start failure synchronously.
  func startStream(
    _ command: String,
    startTimeoutMs: Int,
    onLine: @escaping @Sendable (String) -> Void,
    onEnd: @escaping @Sendable (Int) -> Void,
    onError: @escaping @Sendable (String, String) -> Void
  ) async throws -> Task<Void, Never> {
    let ready = AsyncThrowingStream<Void, Error>.makeStream()
    let task = Task {
      var buffer = Data()
      do {
        let client = try await connected()
        // Citadel's plain executeCommandStream has no cancellation cleanup.
        // withExec owns the channel and closes it when this task is cancelled.
        var started = false
        var readError: Error?
        do {
          try await client.withExec(command) { stream, _ in
            started = true
            do {
              try Task.checkCancellation()
              ready.continuation.finish()
              for try await chunk in stream {
                try Task.checkCancellation()
                guard case .stdout(let data) = chunk else { continue }
                buffer.append(contentsOf: data.readableBytesView)
                while let newline = buffer.firstIndex(of: 0x0A) {
                  let line = buffer[buffer.startIndex..<newline]
                  onLine(String(decoding: line, as: UTF8.self))
                  buffer.removeSubrange(buffer.startIndex...newline)
                }
              }
              try Task.checkCancellation()
            } catch { readError = error }
          }
        } catch ChannelError.alreadyClosed where started {
          // The host may close first. Citadel 0.12.1 closes again in withExec;
          // do not replace the read's real exit/cancellation with alreadyClosed.
        }
        if let readError { throw readError }
        if !buffer.isEmpty {
          onLine(String(decoding: buffer, as: UTF8.self))
        }
        onEnd(0)
      } catch let failed as SSHClient.CommandFailed {
        ready.continuation.finish(throwing: failed)
        if !buffer.isEmpty { onLine(String(decoding: buffer, as: UTF8.self)) }
        onEnd(failed.exitCode)
      } catch is CancellationError {
        ready.continuation.finish(throwing: CancellationError())
      } catch {
        ready.continuation.finish(throwing: error)
        onError("transport_failed", SshFailure.friendly(error))
      }
    }
    do {
      try await withDeadline(startTimeoutMs) {
        for try await _ in ready.stream { }
      }
      return task
    } catch {
      task.cancel()
      throw error
    }
  }

  private func string(_ buffer: ByteBuffer) -> String {
    String(decoding: buffer.readableBytesView, as: UTF8.self)
  }
}
