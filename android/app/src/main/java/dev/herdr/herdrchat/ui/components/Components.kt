package dev.herdr.herdrchat.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.herdr.herdrchat.core.model.AgentStatus
import dev.herdr.herdrchat.core.transcript.ChatMessage
import dev.herdr.herdrchat.core.transcript.MessageSegment
import dev.herdr.herdrchat.ui.theme.HerdrColors

/** Small coloured presence dot for an agent status. */
@Composable
fun PresenceDot(status: AgentStatus, modifier: Modifier = Modifier) {
    Box(status, modifier)
}

@Composable
private fun Box(status: AgentStatus, modifier: Modifier) {
    androidx.compose.foundation.layout.Box(
        modifier
            .size(10.dp)
            .clip(CircleShape)
            .background(HerdrColors.statusColor(status)),
    )
}

/** A single chat bubble. Outgoing (user) bubbles hug the right; agent bubbles the
 *  left. Tool activity and thinking render as compact chips. */
@Composable
fun MessageBubble(message: ChatMessage) {
    val dark = isSystemInDarkTheme()
    val outgoing = message.role == ChatMessage.Role.USER
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (outgoing) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 320.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(if (outgoing) HerdrColors.outgoingBubble(dark) else HerdrColors.incomingBubble(dark))
                .padding(horizontal = 10.dp, vertical = 7.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (message.agentLabel != null && !outgoing) {
                Text(
                    text = message.agentLabel,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = HerdrColors.headerGreen,
                )
            }
            message.segments.forEach { SegmentView(it, dark) }
        }
    }
}

@Composable
private fun SegmentView(segment: MessageSegment, dark: Boolean) {
    when (segment) {
        is MessageSegment.Text -> Text(
            text = segment.value,
            style = MaterialTheme.typography.bodyMedium,
            color = HerdrColors.primaryText(dark),
        )
        is MessageSegment.Thinking -> Chip(Icons.Filled.Psychology, "düşündü", HerdrColors.secondaryText(dark))
        is MessageSegment.ToolUse -> Chip(
            Icons.Filled.Build,
            segment.input?.let { "${segment.name}: $it" } ?: segment.name,
            HerdrColors.headerGreen,
        )
        is MessageSegment.ToolResult -> Chip(Icons.Filled.CheckCircle, "araç sonucu", HerdrColors.secondaryText(dark))
    }
}

@Composable
private fun Chip(icon: ImageVector, label: String, tint: Color) {
    Row(
        modifier = Modifier
            .clip(CircleShape)
            .background(tint.copy(alpha = 0.12f))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(14.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = tint,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Quick-reply bar shown when an agent is blocked, waiting for input. */
@Composable
fun BlockedReplyBar(onKeys: (List<String>) -> Unit) {
    val blocked = HerdrColors.statusColor(AgentStatus.BLOCKED)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(blocked.copy(alpha = 0.10f))
            .padding(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "Agent yanıt bekliyor",
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
            color = blocked,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ReplyButton("Onayla", listOf("enter"), onKeys)
            ReplyButton("1", listOf("1", "enter"), onKeys)
            ReplyButton("2", listOf("2", "enter"), onKeys)
            ReplyButton("Esc", listOf("escape"), onKeys)
        }
    }
}

@Composable
private fun ReplyButton(title: String, keys: List<String>, onKeys: (List<String>) -> Unit) {
    val dark = isSystemInDarkTheme()
    Surface(
        onClick = { onKeys(keys) },
        shape = CircleShape,
        color = HerdrColors.incomingBubble(dark),
    ) {
        Text(
            text = title,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = HerdrColors.primaryText(dark),
        )
    }
}
