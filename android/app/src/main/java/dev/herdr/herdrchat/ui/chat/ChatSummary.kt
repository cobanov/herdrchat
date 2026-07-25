package dev.herdr.herdrchat.ui.chat

import dev.herdr.herdrchat.core.model.AgentInfo
import dev.herdr.herdrchat.core.model.AgentStatus
import dev.herdr.herdrchat.core.model.Workspace

/** One row in the chat list: a workspace, plus the agents running in it. This is
 *  the "conversation" unit (workspace = chat). */
data class ChatSummary(
    val workspaceId: String,
    val title: String,
    val number: Int,
    val status: AgentStatus,
    val agents: List<AgentInfo>,
) {
    val needsAttention: Boolean get() = status.needsAttention

    /** WhatsApp-style presence subtitle. */
    val subtitle: String
        get() = when (status) {
            AgentStatus.WORKING -> "working…"
            AgentStatus.BLOCKED -> "waiting for you"
            AgentStatus.DONE -> "done"
            AgentStatus.IDLE -> if (agents.isEmpty()) "idle" else "online"
            AgentStatus.UNKNOWN -> agents.firstOrNull()?.agent ?: "—"
        }

    /** The pane a message should be sent to: the focused agent, else the first. */
    val primaryPane: AgentInfo?
        get() = agents.firstOrNull { it.focused }
            ?: agents.firstOrNull { it.agent != null }
            ?: agents.firstOrNull()

    companion object {
        /** Build summaries by joining workspace rows with snapshot agents. */
        fun build(workspaces: List<Workspace>, agents: List<AgentInfo>): List<ChatSummary> {
            val byWorkspace = agents.groupBy { it.workspaceId }
            return workspaces
                .sortedBy { it.number }
                .map { w ->
                    ChatSummary(
                        workspaceId = w.workspaceId,
                        title = w.label,
                        number = w.number,
                        status = w.agentStatus,
                        agents = byWorkspace[w.workspaceId] ?: emptyList(),
                    )
                }
        }
    }
}
