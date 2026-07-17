package dev.herdr.herdrchat.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.herdr.herdrchat.core.client.HerdrClient
import dev.herdr.herdrchat.core.transcript.ChatMessage
import dev.herdr.herdrchat.ui.chat.ChatSummary
import dev.herdr.herdrchat.ui.chat.ChatThreadViewModel
import dev.herdr.herdrchat.ui.components.BlockedReplyBar
import dev.herdr.herdrchat.ui.components.MessageBubble
import dev.herdr.herdrchat.ui.theme.HerdrColors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatThreadScreen(
    client: HerdrClient,
    summary: ChatSummary,
    onBack: () -> Unit,
) {
    val model = remember(summary.workspaceId) { ChatThreadViewModel(client, summary) }
    val scope = rememberCoroutineScope()
    val dark = isSystemInDarkTheme()

    LaunchedEffect(summary.workspaceId) { model.start(scope) }
    DisposableEffect(summary.workspaceId) { onDispose { model.stop() } }

    // Bubbles worth showing: hide sidechain chatter and raw tool-result user turns.
    val visible = model.messages.filter {
        !it.isSidechain && !(it.role == ChatMessage.Role.USER && it.isToolOnly)
    }

    val listState = rememberLazyListState()
    LaunchedEffect(visible.size) {
        if (visible.isNotEmpty()) listState.animateScrollToItem(visible.lastIndex)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(model.title, maxLines = 1) },
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
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 12.dp),
            ) {
                items(visible, key = { it.id }) { MessageBubble(it) }
            }

            if (model.isBlocked) {
                BlockedReplyBar { keys -> model.sendKeys(keys) }
            }

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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InputBar(
    draft: String,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    sending: Boolean,
    dark: Boolean,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        OutlinedTextField(
            value = draft,
            onValueChange = onDraftChange,
            modifier = Modifier.weight(1f),
            placeholder = { Text("Mesaj") },
            maxLines = 5,
            shape = RoundedCornerShape(20.dp),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = HerdrColors.incomingBubble(dark),
                unfocusedContainerColor = HerdrColors.incomingBubble(dark),
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
            ),
        )
        IconButton(
            onClick = onSend,
            enabled = draft.trim().isNotEmpty() && !sending,
        ) {
            Icon(
                Icons.Filled.ArrowUpward,
                contentDescription = "Gönder",
                tint = if (draft.trim().isNotEmpty() && !sending) HerdrColors.accent else HerdrColors.secondaryText(dark),
            )
        }
    }
}
