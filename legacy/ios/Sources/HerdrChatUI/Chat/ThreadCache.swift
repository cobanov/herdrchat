import Foundation
import HerdrKit

/// Cache of parsed transcript messages keyed by (connection, workspace), so
/// reopening a chat shows its history instantly instead of re-reading and
/// re-parsing the whole transcript. Persisted to disk (Caches/) so it survives
/// app restarts; also remembers how many bytes of each transcript file were
/// consumed, so the tail can resume from there.
@MainActor
final class ThreadCache {
    static let shared = ThreadCache()

    private struct Entry: Codable {
        var version = 1
        var messages: [ChatMessage] = []
        var bytes: [String: Int] = [:]   // transcript path -> bytes consumed
        /// The Claude session(s) these messages belong to (sorted session ids,
        /// joined). A chat's identity is its session, NOT its workspace slot: when
        /// a workspace is reused by a new session (same agent name), the signature
        /// changes and the stale history is dropped instead of being shown.
        var sessionSig: String? = nil
    }

    private var entries: [String: Entry] = [:]
    private var seen: [String: Set<String>] = [:]
    private var loaded: Set<String> = []
    private var dirty: Set<String> = []
    private var flushTask: Task<Void, Never>?
    private let dir: URL
    private static let maxMessages = 500

    private init() {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        dir = caches.appendingPathComponent("HerdrThreadCache", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    private static func key(_ connectionID: String, _ workspaceId: String) -> String {
        let raw = "\(connectionID)-\(workspaceId)"
        return String(raw.map { $0.isLetter || $0.isNumber || $0 == "-" ? $0 : "_" })
    }

    private func fileURL(_ key: String) -> URL { dir.appendingPathComponent("\(key).json") }

    private func entry(_ key: String) -> Entry {
        if !loaded.contains(key) {
            loaded.insert(key)
            if let data = try? Data(contentsOf: fileURL(key)),
               let stored = try? JSONDecoder().decode(Entry.self, from: data),
               stored.sessionSig != nil {
                // A stored entry always carries the session it belongs to. One
                // without a signature is legacy/unbound — ignore its messages so
                // a new session can never inherit them.
                entries[key] = stored
                seen[key] = Set(stored.messages.map(\.id))
            }
        }
        return entries[key] ?? Entry()
    }

    private func markDirty(_ key: String) {
        dirty.insert(key)
        guard flushTask == nil else { return }
        flushTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(800))
            self?.flush()
        }
    }

    private func flush() {
        flushTask = nil
        for key in dirty {
            guard let entry = entries[key] else { continue }
            if let data = try? JSONEncoder().encode(entry) {
                try? data.write(to: fileURL(key), options: .atomic)
            }
        }
        dirty.removeAll()
    }

    // MARK: - API

    func messages(_ connectionID: String, _ workspaceId: String) -> [ChatMessage] {
        entry(Self.key(connectionID, workspaceId)).messages
    }

    func seenIDs(_ connectionID: String, _ workspaceId: String) -> Set<String> {
        let key = Self.key(connectionID, workspaceId)
        _ = entry(key)
        return seen[key] ?? []
    }

    /// The session signature the cached messages belong to (nil = nothing bound).
    func sessionSig(_ connectionID: String, _ workspaceId: String) -> String? {
        entry(Self.key(connectionID, workspaceId)).sessionSig
    }

    /// Bind this workspace's cache to `sessionSig`. If it already held a
    /// different session, its messages/cursors are dropped (the workspace now
    /// hosts a new conversation). Returns true only when a real prior session
    /// was replaced — the signal for the caller to also clear in-memory history.
    @discardableResult
    func rebind(_ connectionID: String, _ workspaceId: String, sessionSig: String) -> Bool {
        let key = Self.key(connectionID, workspaceId)
        var e = entry(key)
        guard e.sessionSig != sessionSig else { return false }
        let replaced = e.sessionSig != nil
        e.messages.removeAll()
        e.bytes.removeAll()
        e.sessionSig = sessionSig
        entries[key] = e
        seen[key] = []
        markDirty(key)
        return replaced
    }

    /// Record a freshly parsed message (deduped by id).
    func add(_ connectionID: String, _ workspaceId: String, _ message: ChatMessage) {
        let key = Self.key(connectionID, workspaceId)
        var e = entry(key)
        var ids = seen[key] ?? []
        guard ids.insert(message.id).inserted else { return }
        e.messages.append(message)
        if e.messages.count > Self.maxMessages {
            e.messages.removeFirst(e.messages.count - Self.maxMessages)
        }
        entries[key] = e
        seen[key] = ids
        markDirty(key)
    }

    func bytes(_ connectionID: String, _ workspaceId: String, path: String) -> Int? {
        entry(Self.key(connectionID, workspaceId)).bytes[path]
    }

    func setBytes(_ connectionID: String, _ workspaceId: String, path: String, _ value: Int) {
        let key = Self.key(connectionID, workspaceId)
        var e = entry(key)
        e.bytes[path] = value
        entries[key] = e
        markDirty(key)
    }

    /// Drop a transcript's byte cursor so its next tail re-reads from the start
    /// (used when the file rotated / shrank).
    func resetBytes(_ connectionID: String, _ workspaceId: String, path: String) {
        let key = Self.key(connectionID, workspaceId)
        var e = entry(key)
        e.bytes[path] = nil
        entries[key] = e
        markDirty(key)
    }

    /// Remove all cached threads belonging to a connection (edit/delete).
    func clear(connectionID: String) {
        let prefix = String("\(connectionID)-".map { $0.isLetter || $0.isNumber || $0 == "-" ? $0 : "_" })
        for key in Set(entries.keys).union(loaded) where key.hasPrefix(prefix) {
            entries[key] = nil
            seen[key] = nil
            loaded.remove(key)
            dirty.remove(key)
            try? FileManager.default.removeItem(at: fileURL(key))
        }
    }
}
