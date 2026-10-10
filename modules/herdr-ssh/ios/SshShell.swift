import Foundation
import Citadel
import NIOCore
import NIOSSH

/// How a shell channel ended, as JavaScript receives it in `onShellClosed`.
struct ShellEnd: Sendable {
  /// `exited`: the command ended (its status in `exitCode`).
  /// `connection_lost`: the SSH connection under it went away (route change,
  /// host gone, the connection was dropped).
  /// `transport_failed`: the channel itself failed.
  let reason: String
  let exitCode: Int?
  let message: String?
}

/// One open PTY shell: where its input goes, and the task that owns it.
final class ShellHandle: @unchecked Sendable {
  enum Event: Sendable {
    case data(Data)
    case resize(cols: Int, rows: Int)
  }

  let input: AsyncStream<Event>.Continuation
  private let lock = NSLock()
  private var task: Task<Void, Never>?

  init(input: AsyncStream<Event>.Continuation) {
    self.input = input
  }

  func write(_ data: Data) {
    guard !data.isEmpty else { return }
    input.yield(.data(data))
  }

  func resize(cols: Int, rows: Int) {
    input.yield(.resize(cols: cols, rows: rows))
  }

  func bind(_ task: Task<Void, Never>) {
    lock.lock()
    self.task = task
    lock.unlock()
  }

  /// Hang up: the channel closes, and the host sends the command SIGHUP.
  func close() {
    input.finish()
    lock.lock()
    let task = self.task
    lock.unlock()
    task?.cancel()
  }
}

extension SshConnection {
  /// Open a pseudo-terminal on this connection's client and run `command` in
  /// it. Output goes to `onOutput` (raw bytes, launch noise removed, see
  /// `ShellLaunch`), the end to `onClose` exactly once — except after `close()`
  /// on the handle, which is the app's own doing and reports nothing.
  ///
  /// Returns once the channel is open, so a start failure is the caller's to
  /// report; `startTimeoutMs` bounds that, and also how long the launch marker
  /// is waited for before the output is shown as it is.
  ///
  /// The shell shares the connection: a route change or `disconnect` that
  /// drops the client ends it with `connection_lost`. It is never reopened
  /// here; reconnecting is the person's choice, from the screen.
  func openShell(
    _ command: String,
    cols: Int,
    rows: Int,
    term: String,
    startTimeoutMs: Int,
    onOutput: @escaping @Sendable (Data) -> Void,
    onClose: @escaping @Sendable (ShellEnd) -> Void
  ) async throws -> ShellHandle {
    let (inputStream, inputContinuation) = AsyncStream<ShellHandle.Event>.makeStream()
    let handle = ShellHandle(input: inputContinuation)
    let ready = AsyncThrowingStream<Void, Error>.makeStream()
    let nonce = ShellLaunch.nonce()
    let gate = MarkerGate(nonce: nonce, sink: onOutput)
    let launch = ShellLaunch.line(command: command, nonce: nonce)
    let request = SSHChannelRequestEvent.PseudoTerminalRequest(
      wantReply: true,
      term: term,
      terminalCharacterWidth: max(cols, 1),
      terminalRowHeight: max(rows, 1),
      terminalPixelWidth: 0,
      terminalPixelHeight: 0,
      terminalModes: SSHTerminalModes([:])
    )

    let task = Task {
      var client: SSHClient?
      var started = false
      var exitCode = 0
      do {
        let connectedClient = try await connected()
        client = connectedClient
        do {
          try await connectedClient.withPTY(request) { inbound, outbound in
            started = true
            try Task.checkCancellation()
            ready.continuation.finish()
            try await outbound.write(ByteBuffer(string: launch))
            try await withThrowingTaskGroup(of: Void.self) { group in
              group.addTask {
                for await event in inputStream {
                  switch event {
                  case .data(let data):
                    try await outbound.write(ByteBuffer(bytes: data))
                  case .resize(let cols, let rows):
                    try await outbound.changeSize(cols: cols, rows: rows, pixelWidth: 0, pixelHeight: 0)
                  }
                }
              }
              group.addTask {
                try? await Task.sleep(nanoseconds: UInt64(max(startTimeoutMs, 0)) * 1_000_000)
                if !Task.isCancelled { gate.expire() }
              }
              defer { group.cancelAll() }
              do {
                for try await chunk in inbound {
                  try Task.checkCancellation()
                  switch chunk {
                  case .stdout(let buffer), .stderr(let buffer):
                    gate.feed(Data(buffer.readableBytesView))
                  }
                }
              } catch let failed as SSHClient.CommandFailed {
                // Kept rather than thrown: withPTY closes the channel on the
                // way out, and when the host has closed it already, that close
                // throws alreadyClosed in place of this error.
                exitCode = failed.exitCode
              }
            }
          }
        } catch ChannelError.alreadyClosed where started {
          // The host closed first; Citadel's own close after it is not news.
        }
        gate.expire()
        // Closed by the app: nothing to report.
        if Task.isCancelled { return }
        onClose(Self.ended(client: client, exitCode: exitCode))
      } catch is CancellationError {
        ready.continuation.finish(throwing: CancellationError())
      } catch {
        if Task.isCancelled {
          ready.continuation.finish(throwing: CancellationError())
          return
        }
        gate.expire()
        ready.continuation.finish(throwing: error)
        if started {
          if let client, !client.isConnected {
            onClose(ShellEnd(reason: "connection_lost", exitCode: nil, message: SshFailure.friendly(error)))
          } else {
            onClose(ShellEnd(reason: "transport_failed", exitCode: nil, message: SshFailure.friendly(error)))
          }
        }
      }
    }
    handle.bind(task)

    do {
      try await withDeadlineForShell(startTimeoutMs) {
        for try await _ in ready.stream { }
      }
      return handle
    } catch {
      handle.close()
      if let failure = error as? SshFailure { throw failure }
      if error is SSHClient.CommandFailed {
        throw SshFailure(code: "transport_failed", message: "The shell ended before it started.")
      }
      throw SshFailure(code: "transport_failed", message: SshFailure.friendly(error))
    }
  }

  /// A channel that ended without an error: the command exited, unless the
  /// connection under it is what went.
  private static func ended(client: SSHClient?, exitCode: Int) -> ShellEnd {
    if let client, !client.isConnected {
      return ShellEnd(reason: "connection_lost", exitCode: nil, message: nil)
    }
    return ShellEnd(reason: "exited", exitCode: exitCode, message: nil)
  }

  /// `withDeadline`, without dropping the client on a timeout: a shell that is
  /// slow to open says nothing about the commands sharing the connection.
  private func withDeadlineForShell(
    _ timeoutMs: Int,
    _ operation: @escaping @Sendable () async throws -> Void
  ) async throws {
    guard timeoutMs > 0 else { return try await operation() }
    try await withThrowingTaskGroup(of: Void.self) { group in
      group.addTask { try await operation() }
      group.addTask {
        try await Task.sleep(nanoseconds: UInt64(timeoutMs) * 1_000_000)
        throw SshFailure(
          code: "timeout",
          message: "The host didn't open a terminal in time. Check that it's awake and on the tailnet."
        )
      }
      _ = try await group.next()
      group.cancelAll()
    }
  }
}
