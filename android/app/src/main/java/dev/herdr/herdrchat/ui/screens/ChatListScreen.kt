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
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
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
import dev.herdr.herdrchat.core.model.PermissionMode
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatListScreen(
    store: ConnectionStore,
    connection: ServerConnection,
    model: WorkspacesViewModel,
    onOpenThread: (ChatSummary) -> Unit,
    onOpenConnections: () -> Unit,
) {
    // `model` is hoisted to RootScreen so it survives navigating into a thread and
    // back — the list keeps its rows (no reconnect / "Connecting…" flash).
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var watchEnabled by remember {
        mutableStateOf(dev.herdr.herdrchat.notify.WatchControl.isEnabled(context))
    }
    var showNewWorkspace by remember { mutableStateOf(false) }
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
                    IconButton(onClick = { showNewWorkspace = true }) {
                        Icon(Icons.Filled.Add, contentDescription = "New chat")
                    }
                    IconButton(onClick = { toggleWatch() }) {
                        Icon(
                            if (watchEnabled) Icons.Filled.Notifications else Icons.Filled.NotificationsOff,
                            contentDescription = if (watchEnabled) "Notifications on" else "Notifications off",
                        )
                    }
                    IconButton(onClick = onOpenConnections) {
                        Icon(Icons.Filled.Dns, contentDescription = "Servers")
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
                        item {
                            ConnectionErrorRow(
                                message = error,
                                canInstallHerdr = model.herdrMissing,
                                installing = model.isInstallingHerdr,
                                onInstall = { model.installHerdr(scope) },
                            )
                        }
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

    if (showNewWorkspace) {
        NewWorkspaceSheet(
            model = model,
            onDismiss = { showNewWorkspace = false },
            onCreated = onOpenThread,
        )
    }
}

/** Bottom sheet to start a new conversation: create a workspace at a chosen
 *  working directory on the host and launch Claude in it. Prefills the last-used
 *  directory and offers directories already in use as one-tap suggestions. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NewWorkspaceSheet(
    model: WorkspacesViewModel,
    onDismiss: () -> Unit,
    onCreated: (ChatSummary) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var cwd by remember { mutableStateOf(model.lastCwd) }
    var label by remember { mutableStateOf("") }
    var permissionMode by remember { mutableStateOf(model.lastPermissionMode) }
    var creating by remember { mutableStateOf(false) }
    var showPicker by remember { mutableStateOf(false) }

    ModalBottomSheet(onDismissRequest = { if (!creating) onDismiss() }, sheetState = sheetState) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("New chat", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            OutlinedTextField(
                value = cwd,
                onValueChange = { cwd = it },
                label = { Text("Working directory") },
                placeholder = { Text("/Users/…/project") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                "Claude starts in this directory. Type a path, or browse the device's folders to pick one.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            TextButton(
                onClick = { showPicker = true },
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 4.dp, vertical = 4.dp),
            ) {
                Icon(Icons.Filled.Folder, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("  Choose folder on device")
            }
            val known = model.knownCwds
            if (known.isNotEmpty()) {
                Text(
                    "Recent",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                known.forEach { dir ->
                    Text(
                        text = shortPath(dir),
                        style = MaterialTheme.typography.bodyMedium,
                        color = HerdrColors.accent,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { cwd = dir }
                            .padding(vertical = 6.dp),
                    )
                }
            }
            Text(
                "Permissions",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                PermissionMode.entries.forEach { mode ->
                    val selected = mode == permissionMode
                    Text(
                        text = mode.title,
                        style = MaterialTheme.typography.labelLarge,
                        color = if (selected) Color.White else HerdrColors.accent,
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(if (selected) HerdrColors.accent else Color.Transparent)
                            .clickable { permissionMode = mode }
                            .padding(horizontal = 14.dp, vertical = 7.dp),
                    )
                }
            }
            Text(
                permissionMode.detail,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = label,
                onValueChange = { label = it },
                label = { Text("Name (optional)") },
                placeholder = { Text("Automatic (folder name)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    creating = true
                    scope.launch {
                        val summary = model.createWorkspace(cwd, label.ifBlank { null }, permissionMode)
                        creating = false
                        if (summary != null) {
                            onDismiss()
                            onCreated(summary)
                        }
                    }
                },
                enabled = cwd.isNotBlank() && !creating,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (creating) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White)
                } else {
                    Text("Start")
                }
            }
        }
    }

    if (showPicker) {
        DirectoryPickerDialog(
            model = model,
            start = cwd,
            onDismiss = { showPicker = false },
            onPick = { picked -> cwd = picked },
        )
    }
}

/** Browse the host's filesystem to pick a working directory, instead of typing
 *  an absolute path from memory. Starts at the home directory (or the path
 *  already entered), drills into folders, walks back up, and returns the chosen
 *  directory. One shell round-trip per level over the same transport. */
@Composable
private fun DirectoryPickerDialog(
    model: WorkspacesViewModel,
    start: String,
    onDismiss: () -> Unit,
    onPick: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var path by remember { mutableStateOf("") }
    var entries by remember { mutableStateOf<List<String>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }

    fun navigate(to: String) {
        loading = true
        path = to
        scope.launch {
            entries = model.listDirectories(to)
            loading = false
        }
    }

    LaunchedEffect(Unit) {
        val initial = start.trim().ifEmpty { model.homeDirectory() }
        navigate(initial)
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.92f)
                .fillMaxHeight(0.8f),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(20.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 4.dp,
        ) {
            Column(Modifier.fillMaxSize()) {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                    Text("Choose folder", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        text = path.ifEmpty { " " },
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                HorizontalDivider()
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    if (loading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(28.dp).align(Alignment.Center),
                            color = HerdrColors.accent,
                        )
                    } else {
                        LazyColumn(Modifier.fillMaxSize()) {
                            if (path != "/" && path.isNotEmpty()) {
                                item(key = "..") {
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clickable { navigate(parentPath(path)) }
                                            .padding(horizontal = 16.dp, vertical = 12.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                                    ) {
                                        Icon(Icons.Filled.KeyboardArrowUp, contentDescription = null, tint = HerdrColors.accent)
                                        Text("Parent folder", style = MaterialTheme.typography.bodyLarge)
                                    }
                                }
                            }
                            items(entries, key = { it }) { name ->
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable { navigate(childPath(path, name)) }
                                        .padding(horizontal = 16.dp, vertical = 12.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                                ) {
                                    Icon(Icons.Filled.Folder, contentDescription = null, tint = HerdrColors.accent)
                                    Text(name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                            if (entries.isEmpty()) {
                                item(key = "empty") {
                                    Text(
                                        "No subfolders",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.padding(16.dp),
                                    )
                                }
                            }
                        }
                    }
                }
                HorizontalDivider()
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.End,
                ) {
                    TextButton(onClick = onDismiss) { Text("Cancel") }
                    Button(
                        onClick = { onPick(path); onDismiss() },
                        enabled = path.isNotEmpty() && !loading,
                    ) { Text("Select") }
                }
            }
        }
    }
}

private fun childPath(base: String, name: String): String =
    if (base == "/") "/$name" else "$base/$name"

private fun parentPath(p: String): String {
    if (p == "/" || p.isEmpty()) return "/"
    val idx = p.lastIndexOf('/')
    return if (idx <= 0) "/" else p.substring(0, idx)
}

/** Show the meaningful tail of a long path (the project folder), not the head. */
private fun shortPath(path: String, max: Int = 34): String =
    if (path.length <= max) path else "…" + path.takeLast(max - 1)

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
                "Connecting…",
                modifier = Modifier.padding(top = 14.dp),
                color = MaterialTheme.colorScheme.onBackground,
            )
        } else {
            Text("No workspaces", color = MaterialTheme.colorScheme.onBackground)
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
private fun ConnectionErrorRow(
    message: String,
    canInstallHerdr: Boolean = false,
    installing: Boolean = false,
    onInstall: () -> Unit = {},
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Filled.Warning, contentDescription = null, tint = Color(0xFFE8A33D))
            Column {
                Text("Connection error", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 4,
                )
            }
        }
        if (canInstallHerdr) {
            Button(onClick = onInstall, enabled = !installing, modifier = Modifier.padding(start = 34.dp)) {
                if (installing) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = Color.White)
                    Text("  Installing herdr…")
                } else {
                    Text("Install herdr on the host")
                }
            }
        }
    }
}

private fun initials(title: String): String {
    val letters = title.split(" ").mapNotNull { it.firstOrNull() }.take(2)
    return if (letters.isEmpty()) "?" else letters.joinToString("").uppercase()
}
