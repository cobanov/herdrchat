package dev.herdr.herdrchat.core.model

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNamingStrategy

/** One agent-bearing pane, as returned by `agent.list` / inside `session.snapshot`. */
@Serializable
data class AgentInfo(
    val agent: String? = null,
    val agentStatus: AgentStatus = AgentStatus.UNKNOWN,
    val cwd: String = "",
    val foregroundCwd: String? = null,
    val focused: Boolean = false,
    val paneId: String,
    val tabId: String = "",
    val terminalId: String? = null,
    val workspaceId: String,
    val revision: Int? = null,
) {
    val id: String get() = paneId
}

/** A workspace row, as returned by `workspace.list`. */
@Serializable
data class Workspace(
    val workspaceId: String,
    val label: String = "",
    val number: Int = 0,
    val agentStatus: AgentStatus = AgentStatus.UNKNOWN,
    val focused: Boolean = false,
    val activeTabId: String? = null,
    val paneCount: Int = 0,
    val tabCount: Int = 0,
)

/** A pane row, as returned by `pane.list`. */
@Serializable
data class Pane(
    val paneId: String,
    val workspaceId: String,
    val tabId: String = "",
    val terminalId: String? = null,
    val agent: String? = null,
    val agentStatus: AgentStatus = AgentStatus.UNKNOWN,
    val cwd: String = "",
    val foregroundCwd: String? = null,
    val focused: Boolean = false,
)

/** Full runtime snapshot (`session.snapshot`). Layout geometry is ignored here. */
@Serializable
data class Snapshot(
    val agents: List<AgentInfo> = emptyList(),
    val focusedPaneId: String? = null,
    val focusedTabId: String? = null,
    val focusedWorkspaceId: String? = null,
)

// MARK: - CLI/socket result envelopes

@Serializable data class SnapshotResult(val snapshot: Snapshot)
@Serializable data class WorkspaceListResult(val workspaces: List<Workspace>)
@Serializable data class AgentListResult(val agents: List<AgentInfo>)
@Serializable data class PaneListResult(val panes: List<Pane>)

// MARK: - herdr NDJSON envelope

@Serializable data class HerdrError(val code: String, val message: String)

class HerdrException(val code: String, message: String) :
    Exception("herdr error [$code]: $message")

@Serializable
data class HerdrEnvelope<T>(
    val id: String? = null,
    val result: T? = null,
    val error: HerdrError? = null,
) {
    /** Returns the result or throws the transported error. */
    fun value(): T {
        error?.let { throw HerdrException(it.code, it.message) }
        return result ?: throw HerdrException("empty_response", "response had neither result nor error")
    }
}

/** Shared JSON coding for herdr payloads. herdr uses snake_case on the wire. */
object HerdrJson {
    @OptIn(ExperimentalSerializationApi::class)
    val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        namingStrategy = JsonNamingStrategy.SnakeCase
    }

    inline fun <reified T> decode(text: String): T =
        json.decodeFromString<HerdrEnvelope<T>>(text.trim()).value()
}
