import Foundation

// Expo's decoded fields, without linking an iOS-only Expo runtime into this test.
struct SshConfigRecord {
  var host = "127.0.0.1"
  var port = 22264
  var username = NSUserName()
  var authKind = "privateKey"
  var password: String? = nil
  var privateKey: String? = nil
  var passphrase: String? = nil
  var hostKeyFingerprint: String? = nil
}

@main struct NativeChecks {
  static func main() async throws {
    let pin = HostKeyPin(nil)
    precondition(pin.accept("A") && pin.accept("A") && !pin.accept("B"))
    precondition(pin.fingerprint == "A")
    precondition(!HostKeyPin("saved").accept("foreign"))
    let concurrent = HostKeyPin(nil)
    DispatchQueue.concurrentPerform(iterations: 100) { i in _ = concurrent.accept("key-\(i)") }
    precondition(concurrent.fingerprint != nil && !concurrent.accept("foreign"))
    print("PASS first contact, changed key, concurrent pin checks")

    guard CommandLine.arguments.count == 3 else {
      print("For loopback checks: swift run NativeChecks <test-key> <test-directory>")
      return
    }
    var config = SshConfigRecord()
    config.privateKey = try String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
    let directory = CommandLine.arguments[2]
    // Fixture path is interpolated into shell commands; do not accept shell syntax.
    precondition(directory.range(of: "^/tmp/[a-zA-Z0-9._/-]+$", options: .regularExpression) != nil)
    func startServer(_ config: String) throws -> Process {
      let server = Process()
      server.executableURL = URL(fileURLWithPath: "/usr/sbin/sshd")
      server.arguments = ["-D", "-e", "-f", config]
      server.standardError = FileHandle.nullDevice
      try server.run()
      return server
    }
    var server = try startServer("\(directory)/config")
    defer { if server.isRunning { server.terminate(); server.waitUntilExit() } }
    try await Task.sleep(nanoseconds: 200_000_000)
    precondition(server.isRunning, "Isolated sshd could not start")
    let connection = SshConnection(config: config)
    let output = try await connection.exec("printf ready", timeoutMs: 5000)
    precondition(output.stdout == "ready")
    let failed = try await connection.exec("printf detail; exit 7", timeoutMs: 5000)
    precondition(failed.exitCode == 7 && failed.stdout == "detail")
    for index in 0..<20 {
      let marker = "\(directory)/stream-\(index)"
      let task = try await connection.startStream(
        "trap 'rmdir \(marker)' EXIT; mkdir \(marker); cat", startTimeoutMs: 5000,
        onLine: { _ in }, onEnd: { _ in }, onError: { _, _ in }
      )
      try await Task.sleep(nanoseconds: 50_000_000)
      task.cancel()
      await task.value
    }
    try await Task.sleep(nanoseconds: 200_000_000)
    let remaining = try FileManager.default.contentsOfDirectory(atPath: directory).filter { $0.hasPrefix("stream-") }
    precondition(remaining.isEmpty, "Cancelled remote commands are still running: \(remaining)")
    print("PASS 20 silent native streams close their remote commands")

    let counter = "\(directory)/counter-\(UUID().uuidString)"
    let command = Task { try await connection.exec("printf x >> \(counter); sleep 10", timeoutMs: 3000) }
    for _ in 0..<100 {
      if FileManager.default.fileExists(atPath: counter) { break }
      try await Task.sleep(nanoseconds: 20_000_000)
    }
    precondition(FileManager.default.fileExists(atPath: counter))
    await connection.close()
    _ = await command.result
    let count = try String(contentsOfFile: counter, encoding: .utf8)
    precondition(count == "x", "Ambiguous command was replayed")
    await connection.close()
    print("PASS lost connection after write does not replay the command")

    _ = try await connection.connected()
    await connection.close()
    server.terminate()
    server.waitUntilExit()
    let original = try String(contentsOfFile: "\(directory)/config", encoding: .utf8)
    try original.replacingOccurrences(of: "/host_a", with: "/host_b")
      .write(toFile: "\(directory)/rotated-config", atomically: true, encoding: .utf8)
    server = try startServer("\(directory)/rotated-config")
    try await Task.sleep(nanoseconds: 200_000_000)
    precondition(server.isRunning)
    do {
      _ = try await connection.connected()
      preconditionFailure("Reconnect accepted a different host key")
    } catch let error as SshFailure {
      precondition(error.code == "host_key_changed")
    }
    await connection.close()
    print("PASS real handshake A -> A accepted, A -> B rejected")
  }
}
