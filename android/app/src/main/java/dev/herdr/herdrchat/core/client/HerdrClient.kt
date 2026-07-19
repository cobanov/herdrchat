package dev.herdr.herdrchat.core.client

import dev.herdr.herdrchat.core.model.AgentInfo
import dev.herdr.herdrchat.core.model.AgentListResult
import dev.herdr.herdrchat.core.model.AgentStatus
import dev.herdr.herdrchat.core.model.HerdrJson
import dev.herdr.herdrchat.core.model.Pane
import dev.herdr.herdrchat.core.model.PaneListResult
import dev.herdr.herdrchat.core.model.Snapshot
import dev.herdr.herdrchat.core.model.SnapshotResult
import dev.herdr.herdrchat.core.model.Workspace
import dev.herdr.herdrchat.core.model.WorkspaceCreation
import dev.herdr.herdrchat.core.model.WorkspaceListResult
import dev.herdr.herdrchat.core.net.HerdrTransport
import dev.herdr.herdrchat.core.net.ShellQuoting
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

    /** The host user's home directory — the sensible starting point for browsing
     *  to a working directory in the new-chat folder picker. */
    suspend fun homeDirectory(): String =
        transport.shell("printf %s \"\$HOME\"").trim().ifEmpty { "/" }

    /** Immediate subdirectories of [path] on the host (names only, sorted, hidden
     *  dirs excluded). Powers the new-chat folder picker so a working directory
     *  can be chosen by browsing the device instead of typed from memory. */
    suspend fun listDirectories(path: String): List<String> {
        // `-p` appends "/" to directories and `-L` follows symlinked dirs, so we
        // keep only entries ending in "/" and strip it. An unreadable path yields
        // nothing rather than erroring the picker.
        val command = "cd ${ShellQuoting.quote(path)} 2>/dev/null && ls -1Lp 2>/dev/null; true"
        return transport.shell(command)
            .split("\n")
            .map { it.trim() }
            .filter { it.endsWith("/") }
            .map { it.dropLast(1) }
            .filter { it.isNotEmpty() && it != "." && it != ".." }
            .sortedWith(String.CASE_INSENSITIVE_ORDER)
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

    /** Create a new workspace rooted at [cwd] (optional [label]) without stealing
     *  desktop focus, and return its ids. Follow with [startAgent] on the returned
     *  root pane to launch Claude in it. */
    suspend fun createWorkspace(cwd: String, label: String?): WorkspaceCreation {
        val args = mutableListOf(herdr, "workspace", "create", "--cwd", cwd, "--no-focus")
        if (!label.isNullOrEmpty()) { args += "--label"; args += label }
        return HerdrJson.decode<WorkspaceCreation>(transport.run(args))
    }

    /** Launch an agent in a freshly created pane's shell (e.g. run "claude").
     *  Uses `pane run`, which types the command and presses Enter in one request. */
    suspend fun startAgent(paneId: String, command: String = "claude") {
        ensureOk(transport.run(listOf(herdr, "pane", "run", paneId, command)))
    }

    /** Block until the agent reaches [status] (true) or the timeout elapses
     *  (false). Backs delivery verification after submitting a prompt. */
    suspend fun waitAgentStatus(paneId: String, status: AgentStatus, timeoutMs: Int): Boolean =
        runCatching {
            transport.run(listOf(herdr, "agent", "wait", paneId, "--status", status.raw, "--timeout", timeoutMs.toString()))
        }.isSuccess

    /** Recent unwrapped terminal tail of a pane — the live "what is the agent
     *  doing right now" view while it streams (transcripts are turn-granular). */
    suspend fun paneTail(paneId: String, lines: Int): String =
        transport.run(listOf(herdr, "pane", "read", paneId, "--source", "recent-unwrapped", "--lines", lines.toString()))

    // Surface a transported error if the CLI printed an envelope; commands like
    // `pane run` / `send-keys` print NOTHING on success, so empty output is OK.
    private fun ensureOk(output: String) {
        if (output.isBlank()) return
        HerdrJson.decode<JsonElement>(output)
    }
}
