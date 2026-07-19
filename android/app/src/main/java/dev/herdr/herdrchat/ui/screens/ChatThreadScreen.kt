package dev.herdr.herdrchat.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import dev.herdr.herdrchat.core.client.HerdrClient
import dev.herdr.herdrchat.core.model.AgentStatus
import dev.herdr.herdrchat.core.transcript.ChatMessage
import dev.herdr.herdrchat.ui.chat.ChatSummary
import dev.herdr.herdrchat.ui.chat.ThreadSessions
import dev.herdr.herdrchat.ui.components.BlockedReplyBar
import dev.herdr.herdrchat.ui.components.MessageBubble
import dev.herdr.herdrchat.ui.components.TypingDots
import dev.herdr.herdrchat.ui.theme.HerdrColors
import dev.herdr.herdrchat.ui.theme.pressScale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatThreadScreen(
    client: HerdrClient,
    connectionId: String,
    summary: ChatSummary,
    onBack: () -> Unit,
) {
    // App-scoped session: tails/polling keep running after navigating away.
    val model = remember(connectionId, summary.workspaceId) {
        ThreadSessions.model(connectionId, summary, client)
    }
    val dark = isSystemInDarkTheme()
    val clipboard = LocalClipboardManager.current
    val haptics = LocalHapticFeedback.current

    // Bubbles worth showing: hide sidechain chatter and raw tool-result user turns.
    val visible = model.messages.filter {
        !it.isSidechain && !(it.role == ChatMessage.Role.USER && it.isToolOnly)
    }

    val listState = rememberLazyListState()
    val atBottom by remember {
        derivedStateOf { !listState.canScrollForward }
    }
    LaunchedEffect(visible.size) {
        if (visible.isEmpty()) return@LaunchedEffect
        val lastIsMine = visible.last().role == ChatMessage.Role.USER
        // Don't yank the list while the user is reading scrollback.
        if (atBottom || lastIsMine) listState.animateScrollToItem(visible.lastIndex)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { ThreadTitle(model.title, model.status) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Geri")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = HerdrColors.headerGreen,
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White,
                ),
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(HerdrColors.background(dark))
                .imePadding(),
        ) {
            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp),
                state = listState,
                contentPadding = PaddingValues(vertical = 12.dp),
            ) {
                itemsIndexed(visible, key = { _, m -> m.id }) { i, m ->
                    val prev = visible.getOrNull(i - 1)
                    val grouped = prev != null && prev.role == m.role && prev.agentLabel == m.agentLabel
                    val failed = model.failedEchoIds.contains(m.id)
                    Column(
                        Modifier
                            .animateItem()
                            .padding(top = if (grouped) 2.dp else 8.dp),
                    ) {
                        Box(
                            Modifier.pointerInput(m.id) {
                                detectTapGestures(onLongPress = {
                                    clipboard.setText(AnnotatedString(m.displayText))
                                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                })
                            },
                        ) {
                            MessageBubble(m, grouped)
                        }
                        if (failed) {
                            RetryRow { model.retry(m.id) }
                        }
                    }
                }
            }

            AnimatedVisibility(
                visible = model.isBlocked,
                enter = slideInVertically { it } + fadeIn(),
                exit = slideOutVertically { it } + fadeOut(),
            ) {
                BlockedReplyBar { keys -> model.sendKeys(keys) }
            }

            model.error?.let { ErrorRow(it) { model.clearError() } }

            InputBar(
                draft = model.draft,
                onDraftChange = { model.draft = it },
                onSend = { model.send() },
                sending = model.isSending,
                dark = dark,
            )
        }
    }
}

@Composable
private fun RetryRow(onRetry: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 2.dp),
        horizontalArrangement = Arrangement.End,
    ) {
        Row(
            modifier = Modifier
                .clip(CircleShape)
                .clickable(onClick = onRetry)
                .padding(horizontal = 8.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(
                Icons.Filled.Refresh,
                contentDescription = null,
                tint = HerdrColors.statusColor(AgentStatus.BLOCKED),
                modifier = Modifier.size(13.dp),
            )
            Text(
                "Gönderilemedi — tekrar dene",
                style = MaterialTheme.typography.labelSmall,
                color = HerdrColors.statusColor(AgentStatus.BLOCKED),
            )
        }
    }
}

@Composable
private fun ErrorRow(message: String, onDismiss: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(Icons.Filled.Warning, contentDescription = null, tint = Color(0xFFE8A33D), modifier = Modifier.size(16.dp))
        Text(
            message,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
            modifier = Modifier.weight(1f),
        )
        IconButton(onClick = onDismiss, modifier = Modifier.size(24.dp)) {
            Icon(Icons.Filled.Close, contentDescription = "Kapat", modifier = Modifier.size(14.dp))
        }
    }
}

@Composable
private fun ThreadTitle(title: String, status: AgentStatus) {
    Column {
        Text(title, style = MaterialTheme.typography.titleMedium, color = Color.White, maxLines = 1)
        val subtitle = when (status) {
            AgentStatus.WORKING -> "yazıyor"
            AgentStatus.BLOCKED -> "yanıt bekliyor"
            AgentStatus.DONE -> "bitti"
            AgentStatus.IDLE -> "çevrimiçi"
            AgentStatus.UNKNOWN -> null
        }
        if (subtitle != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.labelMedium,
                    color = Color.White.copy(alpha = 0.85f),
                )
                if (status == AgentStatus.WORKING) TypingDots(color = Color.White.copy(alpha = 0.85f), dotSize = 4.dp)
            }
        }
    }
}

@Composable
private fun InputBar(
    draft: String,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    sending: Boolean,
    dark: Boolean,
) {
    val haptics = LocalHapticFeedback.current
    val canSend = draft.trim().isNotEmpty() && !sending
    val sendBg by animateColorAsState(
        if (canSend) HerdrColors.accent else HerdrColors.secondaryText(dark).copy(alpha = 0.4f),
        label = "sendBg",
    )
    val sendScale by animateFloatAsState(if (canSend) 1f else 0.85f, label = "sendScale")
    val interaction = remember { MutableInteractionSource() }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            modifier = Modifier
                .weight(1f)
                .clip(RoundedCornerShape(22.dp))
                .background(HerdrColors.incomingBubble(dark))
                .padding(horizontal = 16.dp, vertical = 11.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            if (draft.isEmpty()) {
                Text(
                    "Mesaj",
                    style = MaterialTheme.typography.bodyLarge,
                    color = HerdrColors.secondaryText(dark),
                )
            }
            BasicTextField(
                value = draft,
                onValueChange = onDraftChange,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = HerdrColors.primaryText(dark)),
                cursorBrush = androidx.compose.ui.graphics.SolidColor(HerdrColors.accent),
                maxLines = 5,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Box(
            modifier = Modifier
                .size(46.dp)
                .graphicsLayer { scaleX = sendScale; scaleY = sendScale }
                .pressScale(interaction)
                .clip(CircleShape)
                .background(sendBg)
                .clickable(interaction, indication = null, enabled = canSend) {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onSend()
                },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.ArrowUpward,
                contentDescription = "Gönder",
                tint = Color.White,
                modifier = Modifier.size(24.dp),
            )
        }
    }
}
