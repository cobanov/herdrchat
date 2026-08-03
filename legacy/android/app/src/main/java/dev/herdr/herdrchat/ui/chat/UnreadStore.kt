package dev.herdr.herdrchat.ui.chat

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * App-side "unread" tracking, mirroring herdr's own `done` semantics ("the
 * agent finished but you haven't looked"). A workspace becomes unread when a
 * new assistant message lands or its agent finishes while its thread isn't on
 * screen; opening the thread clears it. Persisted so the dots survive a
 * relaunch. Keys are "connectionId|workspaceId".
 */
object UnreadStore {
    private const val PREF = "herdrchat"
    private const val KEY = "unread_keys"

    private var prefs: SharedPreferences? = null

    var unread by mutableStateOf<Set<String>>(emptySet())
        private set

    /** The thread currently on screen — never marked unread. */
    @Volatile var activeKey: String? = null

    fun init(context: Context) {
        prefs = context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        unread = prefs?.getStringSet(KEY, emptySet())?.toSet() ?: emptySet()
    }

    fun key(connectionId: String, workspaceId: String) = "$connectionId|$workspaceId"

    fun isUnread(key: String): Boolean = key in unread

    fun mark(key: String) {
        if (key == activeKey || key in unread) return
        unread = unread + key
        persist()
    }

    fun clear(key: String) {
        if (key !in unread) return
        unread = unread - key
        persist()
    }

    private fun persist() {
        prefs?.edit()?.putStringSet(KEY, unread)?.apply()
    }
}
