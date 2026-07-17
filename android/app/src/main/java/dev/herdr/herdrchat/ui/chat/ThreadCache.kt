package dev.herdr.herdrchat.ui.chat

import dev.herdr.herdrchat.core.transcript.ChatMessage

/**
 * Process-wide cache of parsed transcript messages, keyed by workspace, so
 * reopening a chat shows its history instantly instead of re-reading and
 * re-parsing the whole transcript. Also remembers how many bytes of each
 * transcript file were consumed, so the tail can resume from there.
 */
object ThreadCache {
    private class Entry {
        val messages = mutableListOf<ChatMessage>()
        val seenIds = mutableSetOf<String>()
        val bytes = mutableMapOf<String, Long>()   // transcript path -> bytes consumed
    }

    private val entries = mutableMapOf<String, Entry>()

    private fun entry(workspaceId: String) = entries.getOrPut(workspaceId) { Entry() }

    fun messages(workspaceId: String): List<ChatMessage> = entry(workspaceId).messages.toList()
    fun seenIds(workspaceId: String): Set<String> = entry(workspaceId).seenIds.toSet()

    /** Record a freshly parsed message (deduped by id). Returns true if new. */
    fun add(workspaceId: String, message: ChatMessage): Boolean {
        val e = entry(workspaceId)
        if (!e.seenIds.add(message.id)) return false
        e.messages.add(message)
        return true
    }

    fun consumedBytes(workspaceId: String, path: String): Long? = entry(workspaceId).bytes[path]

    fun setConsumedBytes(workspaceId: String, path: String, bytes: Long) {
        entry(workspaceId).bytes[path] = bytes
    }

    /** Drop a transcript's byte cursor so its next tail re-reads from the start
     *  (used when the file rotated / shrank). */
    fun resetBytes(workspaceId: String, path: String) {
        entry(workspaceId).bytes.remove(path)
    }
}
