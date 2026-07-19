package dev.herdr.herdrchat.ui.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.herdr.herdrchat.core.model.AgentStatus
import dev.herdr.herdrchat.ui.chat.ChatSummary
import dev.herdr.herdrchat.ui.chat.WorkspacesViewModel
import dev.herdr.herdrchat.ui.components.PresenceDot
import dev.herdr.herdrchat.ui.components.TypingDots
import dev.herdr.herdrchat.ui.connection.ConnectionStore
import dev.herdr.herdrchat.ui.connection.ServerConnection
import dev.herdr.herdrchat.ui.theme.HerdrColors
import dev.herdr.herdrchat.ui.theme.avatarColor
import dev.herdr.herdrchat.ui.theme.pressScale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatListScreen(
    store: ConnectionStore,
    connection: ServerConnection,
    onOpenThread: (ChatSummary) -> Unit,
    onOpenConnections: () -> Unit,
) {
    val model = remember(connection.id) { WorkspacesViewModel(store.makeClient(connection), connection.id) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var watchEnabled by remember {
        mutableStateOf(dev.herdr.herdrchat.notify.WatchControl.isEnabled(context))
    }
    val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            dev.herdr.herdrchat.notify.WatchControl.setEnabled(context, true)
            watchEnabled = true
        }
    }
    fun toggleWatch() {
        if (watchEnabled) {
            dev.herdr.herdrchat.notify.WatchControl.setEnabled(context, false)
            watchEnabled = false
        } else if (Build.VERSION.SDK_INT >= 33) {
            notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            dev.herdr.herdrchat.notify.WatchControl.setEnabled(context, true)
            watchEnabled = true
        }
    }

    LaunchedEffect(connection.id) { model.start(scope) }
    DisposableEffect(connection.id) { onDispose { model.stop() } }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(connection.name) },
                actions = {
                    IconButton(onClick = { toggleWatch() }) {
                        Icon(
                            if (watchEnabled) Icons.Filled.Notifications else Icons.Filled.NotificationsOff,
                            contentDescription = if (watchEnabled) "Bildirimler açık" else "Bildirimler kapalı",
                        )
                    }
                    IconButton(onClick = onOpenConnections) {
                        Icon(Icons.Filled.Dns, contentDescription = "Sunucular")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = HerdrColors.headerGreen,
                    titleContentColor = Color.White,
                    actionIconContentColor = Color.White,
                ),
            )
        },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background),
        ) {
            val summaries = model.summaries
            val error = model.connectionError
            if (summaries.isEmpty() && error == null) {
                EmptyState(loading = model.isLoading)
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    if (error != null) {
                        item { ConnectionErrorRow(error) }
                    }
                    items(summaries, key = { it.workspaceId }) { summary ->
                        Column(Modifier.animateItem()) {
                            ChatRow(summary, connection.id) { onOpenThread(summary) }
                            HorizontalDivider(
                                modifier = Modifier.padding(start = 74.dp),
                                thickness = 0.5.dp,
                                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EmptyState(loading: Boolean) {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        if (loading) {
            CircularProgressIndicator(color = HerdrColors.headerGreen)
            Text(
                "Bağlanılıyor…",
                modifier = Modifier.padding(top = 14.dp),
                color = MaterialTheme.colorScheme.onBackground,
            )
        } else {
            Text("Workspace yok", color = MaterialTheme.colorScheme.onBackground)
        }
    }
}

@Composable
private fun ChatRow(summary: ChatSummary, connectionId: String, onClick: () -> Unit) {
    val dark = isSystemInDarkTheme()
    val interaction = remember { MutableInteractionSource() }
    val isUnread = dev.herdr.herdrchat.ui.chat.UnreadStore.unread
        .contains(dev.herdr.herdrchat.ui.chat.UnreadStore.key(connectionId, summary.workspaceId))
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .pressScale(interaction, pressedScale = 0.98f)
            .clickable(interaction, indication = null, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // Leading dot: orange = waiting for you, green = unread result.
        val dotColor = when {
            summary.needsAttention -> HerdrColors.statusColor(AgentStatus.BLOCKED)
            isUnread -> HerdrColors.accent
            else -> Color.Transparent
        }
        Box(
            modifier = Modifier
                .size(9.dp)
                .clip(CircleShape)
                .background(dotColor),
        )
        Box(contentAlignment = Alignment.BottomEnd) {
            val color = avatarColor(summary.title.ifEmpty { summary.workspaceId })
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(color),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = initials(summary.title),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = Color.White,
                )
            }
            PresenceDot(summary.status, ringColor = MaterialTheme.colorScheme.background)
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = summary.title,
                style = MaterialTheme.typography.titleMedium,
                color = HerdrColors.primaryText(dark),
                maxLines = 1,
            )
            Subtitle(summary)
        }
        if (summary.status == AgentStatus.WORKING) {
            androidx.compose.material3.CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                strokeWidth = 2.dp,
                color = HerdrColors.accent,
            )
        }
    }
}

@Composable
private fun Subtitle(summary: ChatSummary) {
    val dark = isSystemInDarkTheme()
    val tint = if (summary.needsAttention) HerdrColors.statusColor(AgentStatus.BLOCKED) else HerdrColors.secondaryText(dark)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = summary.subtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = tint,
            maxLines = 1,
        )
        if (summary.status == AgentStatus.WORKING) {
            TypingDots(color = HerdrColors.statusColor(AgentStatus.WORKING), dotSize = 4.dp)
        }
    }
}

@Composable
private fun ConnectionErrorRow(message: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(Icons.Filled.Warning, contentDescription = null, tint = Color(0xFFE8A33D))
        Column {
            Text("Bağlantı hatası", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(
                text = message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
            )
        }
    }
}

private fun initials(title: String): String {
    val letters = title.split(" ").mapNotNull { it.firstOrNull() }.take(2)
    return if (letters.isEmpty()) "?" else letters.joinToString("").uppercase()
}
