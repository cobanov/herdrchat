import Foundation

/// Shared across handshakes, including concurrent reconnects before JS saves it.
final class HostKeyPin: @unchecked Sendable {
  private let lock = NSLock()
  private var value: String?

  init(_ pin: String?) {
    value = pin?.isEmpty == true ? nil : pin
  }

  var fingerprint: String? {
    lock.lock()
    defer { lock.unlock() }
    return value
  }

  func accept(_ fingerprint: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard !fingerprint.isEmpty, value == nil || value == fingerprint else { return false }
    value = fingerprint
    return true
  }
}
