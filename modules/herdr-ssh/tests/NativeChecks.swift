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

    try await shellPureChecks()

    guard CommandLine.arguments.count == 3 else {
      print("For loopback checks: swift run NativeChecks <test-key> <test-directory>")
      return
    }
    var config = SshConfigRecord()
    // The fixture's sshd config decides the port; HC_CHECK_PORT follows it when
    // another test already holds the default one.
    if let port = ProcessInfo.processInfo.environment["HC_CHECK_PORT"].flatMap(Int.init) { config.port = port }
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

    try await shellLoopbackChecks(connection)

    // untilChannelCloses (src/lib/herdr/shell.ts, kept verbatim here): every
    // stream now runs under it. It must not end a stream that is still open,
    // which it would if Citadel sent end-of-input when the stream starts, and it
    // must stop the command when the stream is cancelled while letting a
    // compound command's own cleanup (the rmdir) run.
    let alive = "\(directory)/wrapped"
    let wrapped = [
      "exec 3<&0",
      "hc_leaves() { if pgrep -P \"$1\" >/dev/null 2>&1; then for hc_c in $(pgrep -P \"$1\"); do hc_leaves \"$hc_c\"; done; else kill \"$1\" 2>/dev/null; fi; }",
      "{ mkdir \(alive); sleep 30; rmdir \(alive)",
      "} </dev/null &",
      "hc_job=$!",
      "( cat <&3 >/dev/null; hc_leaves \"$hc_job\" ) &",
      "hc_watch=$!",
      "wait \"$hc_job\"; hc_rc=$?",
      "hc_leaves \"$hc_watch\"",
      "exit \"$hc_rc\"",
    ].joined(separator: "\n")
    let wrappedTask = try await connection.startStream(
      wrapped, startTimeoutMs: 5000, onLine: { _ in }, onEnd: { _ in }, onError: { _, _ in }
    )
    try await Task.sleep(nanoseconds: 1_500_000_000)
    precondition(FileManager.default.fileExists(atPath: alive), "The wrapped command ended while its stream was open")
    wrappedTask.cancel()
    await wrappedTask.value
    try await Task.sleep(nanoseconds: 1_500_000_000)
    precondition(!FileManager.default.fileExists(atPath: alive), "The wrapped command outlived its stream")
    print("PASS a wrapped stream runs while open and stops, with its cleanup, when cancelled")

    // #84: after a reset, the poll, tail, feed and previews all dial at once.
    // They must share one connection, not open one each and leak the extras.
    // `$SSH_CLIENT` carries the client's source port, so distinct values mean
    // distinct connections.
    await connection.close()
    let sources = try await withThrowingTaskGroup(of: String.self) { group in
      for _ in 0..<5 {
        group.addTask { try await connection.exec("printf %s \"$SSH_CLIENT\"", timeoutMs: 5000).stdout }
      }
      var seen: [String] = []
      for try await source in group { seen.append(source) }
      return seen
    }
    precondition(Set(sources).count == 1, "5 concurrent commands dialled \(Set(sources).count) connections")
    print("PASS 5 concurrent commands after a reset share one connection")

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
      let pinnedKey = await connection.acceptedFingerprint
      precondition(error.presentedFingerprint != nil && error.presentedFingerprint != pinnedKey,
                   "A refused key must carry the fingerprint the host presented")
    }
    await connection.close()
    print("PASS real handshake A -> A accepted, A -> B rejected, with the new key's fingerprint")

    // Failed handshakes must not leave their TCP connections open: the polls
    // retry every few seconds, and each leftover pre-auth connection counts
    // against sshd's MaxStartups until it refuses the phone altogether.
    func openConnections() throws -> Int {
      let lsof = Process()
      lsof.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
      lsof.arguments = ["-a", "-p", String(ProcessInfo.processInfo.processIdentifier), "-iTCP:\(config.port)", "-sTCP:ESTABLISHED", "-t"]
      let pipe = Pipe()
      lsof.standardOutput = pipe
      lsof.standardError = FileHandle.nullDevice
      try lsof.run()
      lsof.waitUntilExit()
      _ = pipe.fileHandleForReading.readDataToEndOfFile()
      return try openSockets()
    }
    func openSockets() throws -> Int {
      let lsof = Process()
      lsof.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
      lsof.arguments = ["-a", "-p", String(ProcessInfo.processInfo.processIdentifier), "-iTCP:\(config.port)", "-sTCP:ESTABLISHED", "-Fn"]
      let pipe = Pipe()
      lsof.standardOutput = pipe
      lsof.standardError = FileHandle.nullDevice
      try lsof.run()
      lsof.waitUntilExit()
      let out = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
      return out.split(separator: "\n").filter { $0.hasPrefix("n") }.count
    }
    var pinned = config
    pinned.hostKeyFingerprint = await connection.acceptedFingerprint
    for _ in 0..<8 {
      let attempt = SshConnection(config: pinned)
      if (try? await attempt.connected()) != nil { preconditionFailure("A changed key was accepted") }
      await attempt.close()
    }
    var badKey = config
    badKey.privateKey = try String(contentsOfFile: "\(directory)/host_a", encoding: .utf8)
    badKey.hostKeyFingerprint = nil
    for _ in 0..<8 {
      let attempt = SshConnection(config: badKey)
      if (try? await attempt.connected()) != nil { preconditionFailure("A rejected key logged in") }
      await attempt.close()
    }
    try await Task.sleep(nanoseconds: 500_000_000)
    let leftover = try openConnections()
    precondition(leftover == 0, "\(leftover) connections left open by failed handshakes")
    print("PASS 16 failed handshakes (changed key, rejected key) leave no connection open")
  }
  // MARK: - Terminal shells

  /// The launch line and the marker gate, with no host.
  static func shellPureChecks() async throws {
    let line = ShellLaunch.line(command: "herdr agent attach 'w1:p2'", nonce: "abc")
    let expected = #" exec /bin/sh -c 'echo HERDRCHAT_""SHELL_abc; herdr agent attach '\''w1:p2'\'''"# + "\r"
    precondition(line == expected, "launch line: \(line)")
    // The typed line never contains the joined marker its output carries.
    precondition(!line.contains("HERDRCHAT_SHELL_abc"))

    var passed = Data()
    let gate = MarkerGate(nonce: "abc") { passed.append($0) }
    gate.feed(Data("Last login: today\r\n% ".utf8))
    gate.feed(Data(line.utf8))
    gate.feed(Data("\r\nHERDRCHAT_SH".utf8))
    precondition(passed.isEmpty && !gate.isOpen, "noise before the marker must be held")
    gate.feed(Data("ELL_abc".utf8))
    precondition(passed.isEmpty, "the marker's line ends at its newline")
    gate.feed(Data("\r\n\u{1b}[?1049hscreen".utf8))
    precondition(String(decoding: passed, as: UTF8.self) == "\u{1b}[?1049hscreen", "got \(passed)")
    gate.feed(Data("more".utf8))
    precondition(String(decoding: passed, as: UTF8.self).hasSuffix("screenmore"))

    var failedOpen = Data()
    let stuck = MarkerGate(nonce: "zzz") { failedOpen.append($0) }
    stuck.feed(Data("sh: herdr: not found\r\n".utf8))
    stuck.expire()
    precondition(String(decoding: failedOpen, as: UTF8.self) == "sh: herdr: not found\r\n",
                 "an expired gate shows what the host printed")
    print("PASS launch line quoting, marker gate holds the login noise and fails open")

  }

  /// A real PTY on the loopback sshd: the command runs, the login noise is
  /// gone, typing and resizing reach it, and its exit status comes back.
  static func shellLoopbackChecks(_ connection: SshConnection) async throws {
    final class Collected: @unchecked Sendable {
      let lock = NSLock()
      var output = Data()
      var end: ShellEnd?
      var text: String { lock.lock(); defer { lock.unlock() }; return String(decoding: output, as: UTF8.self) }
      var ended: ShellEnd? { lock.lock(); defer { lock.unlock() }; return end }
    }
    func open(_ command: String, cols: Int = 80, rows: Int = 24) async throws -> (ShellHandle, Collected) {
      let collected = Collected()
      let handle = try await connection.openShell(
        command, cols: cols, rows: rows, term: "xterm-256color", startTimeoutMs: 5000,
        onOutput: { data in collected.lock.lock(); collected.output.append(data); collected.lock.unlock() },
        onClose: { end in collected.lock.lock(); collected.end = end; collected.lock.unlock() }
      )
      return (handle, collected)
    }
    func waitForEnd(_ collected: Collected) async throws -> ShellEnd {
      for _ in 0..<250 {
        if let end = collected.ended { return end }
        try await Task.sleep(nanoseconds: 20_000_000)
      }
      preconditionFailure("the shell never reported its end; output: \(collected.text.debugDescription)")
    }

    let (_, first) = try await open(#"printf 'it'\''s here'; exit 3"#)
    let firstEnd = try await waitForEnd(first)
    precondition(first.text == "it's here", "only the command's output is shown, got \(first.text.debugDescription)")
    precondition(firstEnd.reason == "exited" && firstEnd.exitCode == 3, "end: \(firstEnd)")

    let (sized, sizeOutput) = try await open("read go; stty size", cols: 80, rows: 24)
    sized.resize(cols: 100, rows: 50)
    sized.write(Data("\r".utf8))
    let sizedEnd = try await waitForEnd(sizeOutput)
    precondition(sizeOutput.text.contains("50 100"), "resize reaches the PTY, got \(sizeOutput.text.debugDescription)")
    precondition(sizedEnd.reason == "exited" && sizedEnd.exitCode == 0, "end: \(sizedEnd)")

    let (typed, typedOutput) = try await open(#"read line; echo "got:$line""#)
    typed.write(Data("abc\r".utf8))
    _ = try await waitForEnd(typedOutput)
    precondition(typedOutput.text.contains("got:abc"), "typing reaches the command, got \(typedOutput.text.debugDescription)")

    // Closing from the app hangs up the command and reports nothing.
    let (held, heldOutput) = try await open("sleep 30")
    held.close()
    try await Task.sleep(nanoseconds: 500_000_000)
    precondition(heldOutput.ended == nil, "an app-side close is not reported as an end")

    // The connection going away ends the shell as connection_lost.
    let (dropped, droppedOutput) = try await open("sleep 30")
    await connection.close()
    let droppedEnd = try await waitForEnd(droppedOutput)
    precondition(droppedEnd.reason == "connection_lost", "end: \(droppedEnd)")
    dropped.close()
    print("PASS PTY shell: clean output, typing, resize, exit status, hang-up, lost connection")
  }
}
