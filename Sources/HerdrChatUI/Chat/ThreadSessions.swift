import Foundation
import HerdrKit

/// App-scoped registry of live thread view models, keyed by connection +
/// workspace. Navigating away no longer tears the session down: its transcript
/// tails and status polling keep running (while the app is foreground), so
/// coming back is instant and no messages are missed. A small LRU cap bounds
/// resource use; edited/deleted connections drop their sessions.
@MainActor
final class ThreadSessions {
    static let shared = ThreadSessions()

    private var sessions: [String: ChatThreadViewModel] = [:]
    private var order: [String] = []   // LRU, most recent last
    private let cap = 8

    private init() {}

    func model(connectionID: String, summary: ChatSummary, client: HerdrClient) -> ChatThreadViewModel {
        let key = "\(connectionID)|\(summary.workspaceId)"
        if let existing = sessions[key] {
            touch(key)
            return existing
        }
        let model = ChatThreadViewModel(client: client, connectionID: connectionID, summary: summary)
        sessions[key] = model
        touch(key)
        evictIfNeeded()
        return model
    }

    /// Stop and drop every session of a connection (after edit/delete).
    func drop(connectionID: String) {
        let prefix = "\(connectionID)|"
        for key in sessions.keys where key.hasPrefix(prefix) {
            sessions[key]?.stop()
            sessions[key] = nil
            order.removeAll { $0 == key }
        }
    }

    private func touch(_ key: String) {
        order.removeAll { $0 == key }
        order.append(key)
    }

    private func evictIfNeeded() {
        while sessions.count > cap, let oldest = order.first {
            sessions[oldest]?.stop()
            sessions[oldest] = nil
            order.removeFirst()
        }
    }
}
