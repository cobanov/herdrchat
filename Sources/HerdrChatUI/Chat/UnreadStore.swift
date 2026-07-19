import Foundation
import Observation

/// App-side "unread" tracking, mirroring herdr's own `done` semantics ("the
/// agent finished but you haven't looked"). A workspace becomes unread when a
/// new assistant message lands or its agent finishes while its thread isn't on
/// screen; opening the thread clears it. Persisted so the dots survive a
/// relaunch. Keys are "connectionID|workspaceId".
@MainActor
@Observable
public final class UnreadStore {
    public static let shared = UnreadStore()

    public private(set) var unread: Set<String>
    /// The thread currently on screen — never marked unread.
    public var activeKey: String?

    private static let defaultsKey = "herdrchat.unread"

    private init() {
        unread = Set(UserDefaults.standard.stringArray(forKey: Self.defaultsKey) ?? [])
    }

    public static func key(_ connectionID: String, _ workspaceId: String) -> String {
        "\(connectionID)|\(workspaceId)"
    }

    public func isUnread(_ key: String) -> Bool { unread.contains(key) }

    public func mark(_ key: String) {
        guard key != activeKey, !unread.contains(key) else { return }
        unread.insert(key)
        persist()
    }

    public func clear(_ key: String) {
        guard unread.contains(key) else { return }
        unread.remove(key)
        persist()
    }

    private func persist() {
        UserDefaults.standard.set(Array(unread), forKey: Self.defaultsKey)
    }
}
