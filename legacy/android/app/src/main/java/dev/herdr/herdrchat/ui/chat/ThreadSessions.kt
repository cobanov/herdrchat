package dev.herdr.herdrchat.ui.chat

import dev.herdr.herdrchat.core.client.HerdrClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * App-scoped registry of live thread view models, keyed by connection +
 * workspace. Navigating away no longer tears the session down: its transcript
 * tails and status polling keep running on the registry's own scope (while the
 * app is alive), so coming back is instant and no messages are missed. A small
 * LRU cap bounds resource use; edited/deleted connections drop their sessions.
 */
object ThreadSessions {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val sessions = mutableMapOf<String, ChatThreadViewModel>()
    private val order = mutableListOf<String>()   // LRU, most recent last
    private const val CAP = 8

    fun model(connectionId: String, summary: ChatSummary, client: HerdrClient): ChatThreadViewModel {
        val key = "$connectionId|${summary.workspaceId}"
        sessions[key]?.let { touch(key); return it }
        val model = ChatThreadViewModel(client, connectionId, summary)
        sessions[key] = model
        touch(key)
        evictIfNeeded()
        model.startIfNeeded(scope)
        return model
    }

    /** Stop and drop every session of a connection (after edit/delete). */
    fun drop(connectionId: String) {
        val prefix = "$connectionId|"
        for (key in sessions.keys.toList()) {
            if (!key.startsWith(prefix)) continue
            sessions.remove(key)?.stop()
            order.remove(key)
        }
    }

    private fun touch(key: String) {
        order.remove(key)
        order.add(key)
    }

    private fun evictIfNeeded() {
        while (sessions.size > CAP && order.isNotEmpty()) {
            val oldest = order.removeAt(0)
            sessions.remove(oldest)?.stop()
        }
    }
}
