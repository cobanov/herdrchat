package dev.herdr.herdrchat.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.herdr.herdrchat.core.model.AgentStatus
import dev.herdr.herdrchat.core.transcript.ChatMessage
import dev.herdr.herdrchat.core.transcript.MessageSegment
import dev.herdr.herdrchat.ui.theme.HerdrColors
import dev.herdr.herdrchat.ui.theme.formatTime
import dev.herdr.herdrchat.ui.theme.pressScale

/** Coloured presence dot; pulses a soft ring while the agent is working/blocked. */
@Composable
fun PresenceDot(status: AgentStatus, modifier: Modifier = Modifier, ringColor: Color = Color.Transparent) {
    val color = HerdrColors.statusColor(status)
    val pulsing = status == AgentStatus.WORKING || status == AgentStatus.BLOCKED
    Box(modifier.size(14.dp), contentAlignment = Alignment.Center) {
        if (pulsing) {
            val t = rememberInfiniteTransition(label = "pulse")
            val scale by t.animateFloat(
                1f, 2.4f,
                infiniteRepeatable(tween(1400, easing = FastOutSlowInEasing)), label = "s",
            )
            val alpha by t.animateFloat(
                0.45f, 0f,
                infiniteRepeatable(tween(1400, easing = FastOutSlowInEasing)), label = "a",
            )
            Box(
                Modifier
                    .size(10.dp)
                    .graphicsLayer { scaleX = scale; scaleY = scale; this.alpha = alpha }
                    .clip(CircleShape)
                    .background(color),
            )
        }
        Box(
            Modifier
                .size(11.dp)
                .clip(CircleShape)
                .background(ringColor)
                .padding(1.5.dp)
                .clip(CircleShape)
                .background(color),
        )
    }
}

/** Three bouncing dots for a "typing…" indicator. */
@Composable
fun TypingDots(color: Color, dotSize: Dp = 5.dp) {
    val t = rememberInfiniteTransition(label = "typing")
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
        repeat(3) { i ->
            val a by t.animateFloat(
                0.25f, 1f,
                infiniteRepeatable(tween(560, delayMillis = i * 140, easing = FastOutSlowInEasing), RepeatMode.Reverse),
                label = "dot$i",
            )
            Box(
                Modifier
                    .size(dotSize)
                    .graphicsLayer { alpha = a }
                    .clip(CircleShape)
                    .background(color),
            )
        }
    }
}

/** A single chat bubble. Outgoing (user) hugs the right; agent bubbles the left.
 *  WhatsApp-style asymmetric corner on the first bubble of a run; the rest of the
 *  run stays fully rounded and tighter-spaced. */
@Composable
fun MessageBubble(message: ChatMessage, groupedWithPrev: Boolean) {
    val dark = isSystemInDarkTheme()
    val outgoing = message.role == ChatMessage.Role.USER
    val round = 17.dp
    val tail = 5.dp
    val shape = if (outgoing) {
        RoundedCornerShape(round, if (groupedWithPrev) round else tail, round, round)
    } else {
        RoundedCornerShape(if (groupedWithPrev) round else tail, round, round, round)
    }
    val bubble = if (outgoing) HerdrColors.outgoingBubble(dark) else HerdrColors.incomingBubble(dark)
    val time = remember(message.id) { formatTime(message.timestamp) }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (outgoing) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 328.dp)
                .shadow(1.dp, shape, clip = false)
                .clip(shape)
                .background(bubble)
                .padding(horizontal = 10.dp, vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            if (message.agentLabel != null && !outgoing && !groupedWithPrev) {
                Text(
                    text = message.agentLabel,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = HerdrColors.headerGreen,
                )
            }
            message.segments.forEach { SegmentView(it, dark) }
            if (time != null) {
                Text(
                    text = time,
                    style = MaterialTheme.typography.labelSmall,
                    color = HerdrColors.secondaryText(dark).copy(alpha = 0.8f),
                    modifier = Modifier.align(Alignment.End),
                )
            }
        }
    }
}

@Composable
private fun SegmentView(segment: MessageSegment, dark: Boolean) {
    when (segment) {
        is MessageSegment.Text -> androidx.compose.material3.ProvideTextStyle(MaterialTheme.typography.bodyLarge) {
            MarkdownText(
                markdown = segment.value,
                color = HerdrColors.primaryText(dark),
                onTint = false,
            )
        }
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
            .padding(horizontal = 9.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
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

/** A slim, indeterminate "waiting for the reply" bar shown while the agent
 *  works. Transcripts are turn-granular, so there's no finer token stream to
 *  surface — a quiet sweeping bar reads as progress without pretending to show
 *  content it doesn't have (it replaces the old terminal-tail bubble). */
@Composable
fun WaitingBar(modifier: Modifier = Modifier) {
    val t = rememberInfiniteTransition(label = "waiting")
    val phase by t.animateFloat(
        0f, 1f,
        infiniteRepeatable(tween(1100, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "sweep",
    )
    Box(
        modifier
            .fillMaxWidth()
            .height(3.dp)
            .clip(CircleShape)
            .background(HerdrColors.accent.copy(alpha = 0.14f)),
    ) {
        BoxWithConstraints(Modifier.fillMaxHeight()) {
            val segment = maxWidth * 0.28f
            Box(
                Modifier
                    .offset(x = (maxWidth - segment) * phase)
                    .width(segment)
                    .fillMaxHeight()
                    .clip(CircleShape)
                    .background(HerdrColors.accent),
            )
        }
    }
}

/** Quick-reply bar shown when an agent is blocked, waiting for input. */
@Composable
fun BlockedReplyBar(onKeys: (List<String>) -> Unit) {
    val dark = isSystemInDarkTheme()
    val blocked = HerdrColors.statusColor(AgentStatus.BLOCKED)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(blocked.copy(alpha = if (dark) 0.14f else 0.10f))
            .padding(vertical = 10.dp, horizontal = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            TypingDots(color = blocked, dotSize = 4.dp)
            Text(
                text = "Agent yanıt bekliyor",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
                color = blocked,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ReplyButton("Onayla", listOf("Enter"), onKeys)
            ReplyButton("1", listOf("1", "Enter"), onKeys)
            ReplyButton("2", listOf("2", "Enter"), onKeys)
            ReplyButton("Esc", listOf("Escape"), onKeys)
        }
    }
}

@Composable
private fun ReplyButton(title: String, keys: List<String>, onKeys: (List<String>) -> Unit) {
    val dark = isSystemInDarkTheme()
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = Modifier
            .pressScale(interaction)
            .shadow(1.dp, CircleShape, clip = false)
            .clip(CircleShape)
            .background(HerdrColors.incomingBubble(dark))
            .clickable(interaction, indication = null) { onKeys(keys) }
            .padding(horizontal = 16.dp, vertical = 9.dp),
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = HerdrColors.primaryText(dark),
        )
    }
}
