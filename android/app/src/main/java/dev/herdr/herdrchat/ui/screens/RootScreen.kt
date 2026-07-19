package dev.herdr.herdrchat.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import dev.herdr.herdrchat.ui.chat.ChatSummary
import dev.herdr.herdrchat.ui.chat.WorkspacesViewModel
import dev.herdr.herdrchat.ui.connection.ConnectionStore
import dev.herdr.herdrchat.ui.connection.ServerConnection

/** App entry: shows the chat list for the selected herdr host, or the connection
 *  setup screen if none is configured yet. A small in-memory back stack drives
 *  navigation (mirroring the iOS NavigationStack). */
sealed interface Screen {
    data object ChatList : Screen
    data class Thread(val summary: ChatSummary) : Screen
    data object Connections : Screen
    data class EditConnection(val existing: ServerConnection?) : Screen
}

@Composable
fun RootScreen(store: ConnectionStore) {
    val backStack = remember { mutableStateListOf<Screen>() }

    val hasSelection = store.selected != null
    val base: Screen = if (hasSelection) Screen.ChatList else Screen.Connections
    val current = backStack.lastOrNull() ?: base

    fun push(screen: Screen) = backStack.add(screen)
    fun pop() { if (backStack.isNotEmpty()) backStack.removeAt(backStack.lastIndex) }

    BackHandler(enabled = backStack.isNotEmpty()) { pop() }

    // Hoisted above the `when` so the same instance survives list <-> thread
    // navigation: the chat list keeps its rows and its shared connection instead
    // of reconnecting (matching iOS, where the list is the persistent nav root).
    val workspacesVM: WorkspacesViewModel? = remember(store.selectedId) {
        store.selected?.let { WorkspacesViewModel(store.makeClient(it), it.id) }
    }

    when (current) {
        Screen.ChatList -> {
            val connection = store.selected
            if (connection != null && workspacesVM != null) {
                ChatListScreen(
                    store = store,
                    connection = connection,
                    model = workspacesVM,
                    onOpenThread = { push(Screen.Thread(it)) },
                    onOpenConnections = { push(Screen.Connections) },
                )
            } else {
                // No selection: fall through to connection setup.
                ConnectionListScreen(
                    store = store,
                    onBack = null,
                    onEdit = { push(Screen.EditConnection(it)) },
                    onAddNew = { push(Screen.EditConnection(null)) },
                    onSelect = { store.selectedId = it.id; backStack.clear() },
                )
            }
        }

        is Screen.Thread -> {
            val connection = store.selected
            if (connection == null) {
                pop()
            } else {
                val client = remember(connection.id, (current as Screen.Thread).summary.workspaceId) {
                    store.makeClient(connection)
                }
                ChatThreadScreen(
                    client = client,
                    connectionId = connection.id,
                    summary = (current as Screen.Thread).summary,
                    onBack = { pop() },
                )
            }
        }

        Screen.Connections -> ConnectionListScreen(
            store = store,
            onBack = if (hasSelection) ({ pop() }) else null,
            onEdit = { push(Screen.EditConnection(it)) },
            onAddNew = { push(Screen.EditConnection(null)) },
            onSelect = { store.selectedId = it.id; backStack.clear() },
        )

        is Screen.EditConnection -> ConnectionEditScreen(
            store = store,
            existing = (current as Screen.EditConnection).existing,
            onDone = { pop() },
        )
    }
}
