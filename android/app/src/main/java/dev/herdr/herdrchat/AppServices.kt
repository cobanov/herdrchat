package dev.herdr.herdrchat

import android.content.Context
import dev.herdr.herdrchat.ui.connection.ConnectionStore

/** Process-wide singletons shared by the UI and the watch service, so both use
 *  the SAME ConnectionStore (and therefore the same persistent SSH client). */
object AppServices {
    @Volatile private var _store: ConnectionStore? = null

    fun store(context: Context): ConnectionStore =
        _store ?: synchronized(this) {
            _store ?: ConnectionStore(context.applicationContext).also { _store = it }
        }
}
