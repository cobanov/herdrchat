package dev.herdr.herdrchat.core.client

import dev.herdr.herdrchat.core.model.AgentInfo
import dev.herdr.herdrchat.core.model.AgentListResult
import dev.herdr.herdrchat.core.model.HerdrJson
import dev.herdr.herdrchat.core.model.Pane
import dev.herdr.herdrchat.core.model.PaneListResult
import dev.herdr.herdrchat.core.model.Snapshot
import dev.herdr.herdrchat.core.model.SnapshotResult
import dev.herdr.herdrchat.core.model.Workspace
import dev.herdr.herdrchat.core.model.WorkspaceListResult
import dev.herdr.herdrchat.core.net.HerdrTransport
import dev.herdr.herdrchat.core.net.run
import kotlinx.serialization.json.JsonElement

/**
 * High-level herdr operations over any transport. Command shapes mirror the
 * `herdr` CLI helpers, which wrap the socket API and print `{id, result}` JSON.
 */
class HerdrClient(
    val transport: HerdrTransport,
    private val herdr: String = "herdr",
) {
    // Reads
    suspend fun snapshot(): Snapshot =
        HerdrJson.decode<SnapshotResult>(transport.run(listOf(herdr, "api", "snapshot"))).snapshot

    suspend fun workspaces(): List<Workspace> =
        HerdrJson.decode<WorkspaceListResult>(transport.run(listOf(herdr, "workspace", "list"))).workspaces

    suspend fun agents(): List<AgentInfo> =
        HerdrJson.decode<AgentListResult>(transport.run(listOf(herdr, "agent", "list"))).agents

    suspend fun panes(): List<Pane> =
        HerdrJson.decode<PaneListResult>(transport.run(listOf(herdr, "pane", "list"))).panes

    /** Confirms the host is reachable and herdr is answering. */
    suspend fun ping() {
        transport.run(listOf(herdr, "status", "server"))
    }

    // Writes

    /** Type a chat message into an agent pane and submit it. `pane run` sends the
     *  text and a real Enter in one request — a separate `send-keys enter` types
     *  the text but doesn't submit inside an agent TUI (only in a plain shell). */
    suspend fun sendMessage(paneId: String, text: String) {
        ensureOk(transport.run(listOf(herdr, "pane", "run", paneId, text)))
    }

    /** Send raw keys to a pane, e.g. quick-reply to a blocked prompt. */
    suspend fun sendKeys(paneId: String, keys: List<String>) {
        ensureOk(transport.run(listOf(herdr, "pane", "send-keys", paneId) + keys))
    }

    // Decode just to surface a transported error; ignore the body.
    private fun ensureOk(output: String) {
        HerdrJson.decode<JsonElement>(output)
    }
}
