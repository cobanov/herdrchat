import Foundation

/// How a command is started on an SSH pseudo-terminal, and how everything the
/// login shell prints before it is cut away.
///
/// Citadel 0.12.1 opens a PTY only together with a `shell` request: its exec
/// request has no PTY variant, and the channel-creation API that would allow
/// one is internal. So the terminal is a login shell, and the command is typed
/// into it. Left alone, the screen would open on the host's MOTD, "Last
/// login", a prompt and the echo of a long `exec /bin/sh -c '…'` line before
/// the attached pane drew over it, and all of that would sit in the
/// scrollback.
///
/// The typed line therefore starts with a marker the shell prints, and
/// `MarkerGate` drops every byte up to and including the line that carries
/// it. The marker is split in the typed text (`HERDRCHAT_""SHELL_<nonce>`), so
/// neither the tty's echo nor the line editor's redraw of it ever contains the
/// joined form that only the shell's output has. The nonce keeps an old
/// session's text in a reused scrollback from matching.
///
/// The command runs under `/bin/sh -c` whatever the login shell is, so the
/// command string is POSIX shell (as `src/lib/herdr/shell.ts` writes it). The
/// line the login shell parses uses only single quotes, with `'\''` for a
/// quote inside: zsh, bash, dash, ksh and fish all read that the same way, as
/// long as the command itself has no backslash (fish keeps `\\` special inside
/// single quotes). `exec` replaces the login shell, so when the command ends
/// the channel closes with its exit status. The leading space keeps the line
/// out of shells' history where `ignorespace` is on.
enum ShellLaunch {
  static let markerPrefix = "HERDRCHAT_SHELL_"

  /// What is typed into the login shell, Return included.
  static func line(command: String, nonce: String) -> String {
    let script = "echo HERDRCHAT_\"\"SHELL_\(nonce); \(command)"
    return " exec /bin/sh -c \(quote(script))\r"
  }

  /// POSIX single quoting.
  static func quote(_ value: String) -> String {
    "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
  }

  /// A short random token, hex, for one shell's marker.
  static func nonce() -> String {
    (0..<8).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
  }
}

/// Holds a shell's output back until the launch marker has gone by, then
/// passes everything through unchanged.
///
/// Fails open: if the marker has not appeared by the deadline (an exotic login
/// shell that mangles the line, a `.profile` that waits for input), `expire`
/// releases everything held, so the person sees what the host printed instead
/// of a blank screen. The held bytes are bounded for the same reason.
///
/// Thread-safe: output arrives on the SSH event loop's task, the deadline on
/// another. The sink is called under the lock so the two can never reorder.
final class MarkerGate: @unchecked Sendable {
  private let marker: [UInt8]
  private let sink: (Data) -> Void
  private let lock = NSLock()
  private var held = Data()
  private var open = false
  /// Beyond this, the marker is not coming; show what there is.
  static let maxHeldBytes = 256 * 1024

  init(nonce: String, sink: @escaping (Data) -> Void) {
    self.marker = Array((ShellLaunch.markerPrefix + nonce).utf8)
    self.sink = sink
  }

  var isOpen: Bool {
    lock.lock()
    defer { lock.unlock() }
    return open
  }

  func feed(_ bytes: Data) {
    lock.lock()
    defer { lock.unlock() }
    if open {
      if !bytes.isEmpty { sink(bytes) }
      return
    }
    held.append(bytes)
    if let start = Self.find(marker, in: held) {
      // Through the end of the marker's line: the shell's newline arrives as
      // "\r\n" on a PTY, possibly in a later chunk.
      let afterMarker = start + marker.count
      guard let newline = held[held.startIndex.advanced(by: afterMarker)...].firstIndex(of: 0x0A) else {
        return
      }
      let rest = held[(newline + 1)...]
      held = Data()
      open = true
      if !rest.isEmpty { sink(Data(rest)) }
      return
    }
    if held.count > Self.maxHeldBytes { release() }
  }

  /// The deadline: stop waiting for the marker.
  func expire() {
    lock.lock()
    defer { lock.unlock() }
    if !open { release() }
  }

  private func release() {
    open = true
    let all = held
    held = Data()
    if !all.isEmpty { sink(all) }
  }

  /// Offset of `needle` in `haystack`, relative to its start index.
  static func find(_ needle: [UInt8], in haystack: Data) -> Int? {
    guard !needle.isEmpty, haystack.count >= needle.count else { return nil }
    let bytes = [UInt8](haystack)
    let last = bytes.count - needle.count
    var index = 0
    while index <= last {
      if bytes[index] == needle[0] && Array(bytes[index..<(index + needle.count)]) == needle {
        return index
      }
      index += 1
    }
    return nil
  }
}
