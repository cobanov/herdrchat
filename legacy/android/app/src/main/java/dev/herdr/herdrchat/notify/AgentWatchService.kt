package dev.herdr.herdrchat.notify

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import dev.herdr.herdrchat.AppServices
import dev.herdr.herdrchat.MainActivity
import dev.herdr.herdrchat.R
import dev.herdr.herdrchat.core.model.AgentStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Foreground service that keeps watching herdr over the shared SSH connection
 * and fires LOCAL notifications when an agent needs you (`blocked`) or finishes
 * (`done`) — fully in-app, no push server of any kind. Runs while enabled, even
 * with the UI closed (a small persistent notification keeps the process alive,
 * which is how Android permits background networking).
 */
class AgentWatchService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val lastStatus = mutableMapOf<String, AgentStatus>()   // paneId -> status
    private var seeded = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannels()
        startForeground(ONGOING_ID, ongoingNotification())
        scope.launch { watchLoop() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private suspend fun watchLoop() {
        val store = AppServices.store(applicationContext)
        while (scope.isActive) {
            val connection = store.selected
            if (connection != null) {
                val client = store.makeClient(connection)
                val snapshot = runCatching { client.snapshot() }.getOrNull()
                if (snapshot != null) {
                    val labels = runCatching { client.workspaces() }.getOrNull()
                        ?.associate { it.workspaceId to it.label } ?: emptyMap()
                    for (agent in snapshot.agents) {
                        val was = lastStatus[agent.paneId]
                        val now = agent.agentStatus
                        if (seeded && was != now && (now == AgentStatus.BLOCKED || now == AgentStatus.DONE)) {
                            notifyTransition(
                                now,
                                labels[agent.workspaceId] ?: agent.workspaceId,
                                agent.agent ?: "agent",
                                agent.paneId,
                            )
                        }
                        lastStatus[agent.paneId] = now
                    }
                    seeded = true
                }
            }
            delay(POLL_MS)
        }
    }

    private fun notifyTransition(status: AgentStatus, workspace: String, agent: String, paneId: String) {
        val (title, body) = when (status) {
            AgentStatus.BLOCKED -> "$workspace is waiting for you" to "$agent is waiting for a reply."
            else -> "$workspace done" to "$agent finished its task."
        }
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_AGENTS)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(open)
            .setAutoCancel(true)
            .setPriority(if (status == AgentStatus.BLOCKED) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .build()
        manager().notify(paneId.hashCode(), notification)
    }

    private fun ongoingNotification(): Notification {
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_WATCH)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("HerdrChat is watching agents")
            .setContentText("You'll be notified when an agent needs you or finishes.")
            .setContentIntent(open)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val m = manager()
        m.createNotificationChannel(
            NotificationChannel(CHANNEL_AGENTS, "Agent notifications", NotificationManager.IMPORTANCE_HIGH),
        )
        m.createNotificationChannel(
            NotificationChannel(CHANNEL_WATCH, "Background watching", NotificationManager.IMPORTANCE_MIN),
        )
    }

    private fun manager() = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    companion object {
        private const val POLL_MS = 5_000L
        private const val ONGOING_ID = 1
        const val CHANNEL_AGENTS = "agents"
        const val CHANNEL_WATCH = "watch"
    }
}

/** Enable/disable the background watch (persisted; auto-restores on app start). */
object WatchControl {
    private const val PREF = "herdrchat"
    private const val KEY = "watch_enabled"

    fun isEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE).getBoolean(KEY, false)

    fun setEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY, enabled).apply()
        val intent = Intent(context, AgentWatchService::class.java)
        if (enabled) context.startForegroundService(intent) else context.stopService(intent)
    }

    /** Start the service on app launch when previously enabled. */
    fun restoreIfEnabled(context: Context) {
        if (isEnabled(context)) {
            runCatching { context.startForegroundService(Intent(context, AgentWatchService::class.java)) }
        }
    }
}
