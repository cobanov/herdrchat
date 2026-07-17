package dev.herdr.herdrchat.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dns
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.herdr.herdrchat.ui.chat.ChatSummary
import dev.herdr.herdrchat.ui.chat.WorkspacesViewModel
import dev.herdr.herdrchat.ui.components.PresenceDot
import dev.herdr.herdrchat.ui.connection.ConnectionStore
import dev.herdr.herdrchat.ui.connection.ServerConnection
import dev.herdr.herdrchat.ui.theme.HerdrColors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatListScreen(
    store: ConnectionStore,
    connection: ServerConnection,
    onOpenThread: (ChatSummary) -> Unit,
    onOpenConnections: () -> Unit,
) {
    val model = remember(connection.id) { WorkspacesViewModel(store.makeClient(connection)) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(connection.id) { model.start(scope) }
    DisposableEffect(connection.id) { onDispose { model.stop() } }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(connection.name) },
                actions = {
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
                        ChatRow(summary) { onOpenThread(summary) }
                        HorizontalDivider(modifier = Modifier.padding(start = 74.dp), thickness = 0.5.dp)
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
            Spacer(Modifier.size(12.dp))
            Text("Bağlanılıyor…", color = MaterialTheme.colorScheme.onBackground)
        } else {
            Text("Workspace yok", color = MaterialTheme.colorScheme.onBackground)
        }
    }
}

@Composable
private fun ChatRow(summary: ChatSummary, onClick: () -> Unit) {
    val dark = isSystemInDarkTheme()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(contentAlignment = Alignment.BottomEnd) {
            Box(
                modifier = Modifier
                    .size(46.dp)
                    .clip(CircleShape)
                    .background(HerdrColors.headerGreen.copy(alpha = 0.18f)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = initials(summary.title),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = HerdrColors.headerGreen,
                )
            }
            PresenceDot(summary.status)
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = summary.title,
                style = MaterialTheme.typography.titleMedium,
                color = HerdrColors.primaryText(dark),
                maxLines = 1,
            )
            Text(
                text = summary.subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = if (summary.needsAttention) HerdrColors.statusColor(dev.herdr.herdrchat.core.model.AgentStatus.BLOCKED)
                else HerdrColors.secondaryText(dark),
                maxLines = 1,
            )
        }
        if (summary.needsAttention) {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .clip(CircleShape)
                    .background(HerdrColors.statusColor(dev.herdr.herdrchat.core.model.AgentStatus.BLOCKED)),
            )
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
