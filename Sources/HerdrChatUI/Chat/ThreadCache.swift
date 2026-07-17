import Foundation
import HerdrKit

/// Process-wide cache of parsed transcript messages, keyed by workspace, so
/// reopening a chat shows its history instantly instead of re-reading and
/// re-parsing the whole transcript. Also remembers how many bytes of each
/// transcript file were consumed, so the tail can resume from there.
@MainActor
final class ThreadCache {
    static let shared = ThreadCache()

    private struct Entry {
        var messages: [ChatMessage] = []
        var seenIDs: Set<String> = []
        var bytes: [String: Int] = [:]   // transcript path -> bytes consumed
    }

    private var entries: [String: Entry] = [:]

    func messages(_ workspaceId: String) -> [ChatMessage] { entries[workspaceId]?.messages ?? [] }
    func seenIDs(_ workspaceId: String) -> Set<String> { entries[workspaceId]?.seenIDs ?? [] }

    /// Record a freshly parsed message (deduped by id).
    func add(_ workspaceId: String, _ message: ChatMessage) {
        var entry = entries[workspaceId] ?? Entry()
        guard entry.seenIDs.insert(message.id).inserted else { return }
        entry.messages.append(message)
        entries[workspaceId] = entry
    }

    func bytes(_ workspaceId: String, path: String) -> Int? { entries[workspaceId]?.bytes[path] }

    func setBytes(_ workspaceId: String, path: String, _ value: Int) {
        var entry = entries[workspaceId] ?? Entry()
        entry.bytes[path] = value
        entries[workspaceId] = entry
    }

    /// Drop a transcript's byte cursor so its next tail re-reads from the start
    /// (used when the file rotated / shrank).
    func resetBytes(_ workspaceId: String, path: String) {
        entries[workspaceId]?.bytes[path] = nil
    }
}
