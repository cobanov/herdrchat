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
               let stored = try? JSONDecoder().decode(Entry.self, from: data) {
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
