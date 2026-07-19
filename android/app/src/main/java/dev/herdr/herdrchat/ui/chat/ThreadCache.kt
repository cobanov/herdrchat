package dev.herdr.herdrchat.ui.chat

import android.content.Context
import dev.herdr.herdrchat.core.transcript.ChatMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

/**
 * Cache of parsed transcript messages keyed by (connection, workspace), so
 * reopening a chat shows its history instantly instead of re-reading and
 * re-parsing the whole transcript. Persisted to disk (cacheDir) so it survives
 * app restarts; also remembers how many bytes of each transcript file were
 * consumed, so the tail can resume from there.
 */
object ThreadCache {

    @Serializable
    private class Entry {
        var version: Int = 1
        var messages: MutableList<ChatMessage> = mutableListOf()
        var bytes: MutableMap<String, Long> = mutableMapOf()   // transcript path -> bytes consumed
    }

    private const val MAX_MESSAGES = 500
    private val json = Json { ignoreUnknownKeys = true }
    private val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private var dir: File? = null
    private val entries = mutableMapOf<String, Entry>()
    private val seen = mutableMapOf<String, MutableSet<String>>()
    private val loaded = mutableSetOf<String>()
    private val dirty = mutableSetOf<String>()
    private var flushJob: Job? = null

    /** Call once from Application.onCreate. */
    fun init(context: Context) {
        dir = File(context.cacheDir, "threads").apply { mkdirs() }
    }

    private fun key(connectionId: String, workspaceId: String): String =
        "$connectionId-$workspaceId".map { if (it.isLetterOrDigit() || it == '-') it else '_' }
            .joinToString("")

    private fun file(key: String): File? = dir?.let { File(it, "$key.json") }

    @Synchronized
    private fun entry(key: String): Entry {
        if (loaded.add(key)) {
            file(key)?.takeIf { it.exists() }?.let { f ->
                runCatching { json.decodeFromString<Entry>(f.readText()) }.getOrNull()?.let { stored ->
                    entries[key] = stored
                    seen[key] = stored.messages.map { it.id }.toMutableSet()
                }
            }
        }
        return entries.getOrPut(key) { Entry() }
    }

    @Synchronized
    private fun markDirty(key: String) {
        dirty.add(key)
        if (flushJob?.isActive == true) return
        flushJob = io.launch {
            delay(800)
            flush()
        }
    }

    @Synchronized
    private fun flush() {
        for (key in dirty.toList()) {
            val e = entries[key] ?: continue
            file(key)?.let { f -> runCatching { f.writeText(json.encodeToString(e)) } }
        }
        dirty.clear()
    }

    // MARK: - API

    @Synchronized
    fun messages(connectionId: String, workspaceId: String): List<ChatMessage> =
        entry(key(connectionId, workspaceId)).messages.toList()

    @Synchronized
    fun seenIds(connectionId: String, workspaceId: String): Set<String> {
        val k = key(connectionId, workspaceId)
        entry(k)
        return seen[k]?.toSet() ?: emptySet()
    }

    /** Record a freshly parsed message (deduped by id). Returns true if new. */
    @Synchronized
    fun add(connectionId: String, workspaceId: String, message: ChatMessage): Boolean {
        val k = key(connectionId, workspaceId)
        val e = entry(k)
        val ids = seen.getOrPut(k) { mutableSetOf() }
        if (!ids.add(message.id)) return false
        e.messages.add(message)
        while (e.messages.size > MAX_MESSAGES) e.messages.removeAt(0)
        markDirty(k)
        return true
    }

    @Synchronized
    fun consumedBytes(connectionId: String, workspaceId: String, path: String): Long? =
        entry(key(connectionId, workspaceId)).bytes[path]

    @Synchronized
    fun setConsumedBytes(connectionId: String, workspaceId: String, path: String, bytes: Long) {
        val k = key(connectionId, workspaceId)
        entry(k).bytes[path] = bytes
        markDirty(k)
    }

    /** Drop a transcript's byte cursor so its next tail re-reads from the start
     *  (used when the file rotated / shrank). */
    @Synchronized
    fun resetBytes(connectionId: String, workspaceId: String, path: String) {
        val k = key(connectionId, workspaceId)
        entry(k).bytes.remove(path)
        markDirty(k)
    }

    /** Remove all cached threads belonging to a connection (edit/delete). */
    @Synchronized
    fun clear(connectionId: String) {
        val prefix = key(connectionId, "")
        for (k in (entries.keys + loaded).toSet()) {
            if (!k.startsWith(prefix)) continue
            entries.remove(k)
            seen.remove(k)
            loaded.remove(k)
            dirty.remove(k)
            file(k)?.delete()
        }
    }
}
