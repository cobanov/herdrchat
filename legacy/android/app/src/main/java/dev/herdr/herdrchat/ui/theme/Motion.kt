package dev.herdr.herdrchat.ui.theme

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.absoluteValue

/** Interruptible, no-bounce springs — the default for interactive state changes. */
object Motion {
    val snappy = spring<Float>(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMediumLow)
    val gentle = spring<Float>(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessLow)
}

/** Tactile scale(0.96) on press. Pass the same MutableInteractionSource used by
 *  the element's clickable so the animation tracks real touch state. */
@Composable
fun Modifier.pressScale(interactionSource: MutableInteractionSource, pressedScale: Float = 0.96f): Modifier {
    val pressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) pressedScale else 1f, Motion.snappy, label = "pressScale")
    return graphicsLayer { scaleX = scale; scaleY = scale }
}

/** A stable, pleasant avatar colour derived from a key (workspace title). */
private val avatarPalette = listOf(
    Color(0xFF128C7E), Color(0xFF3B76C4), Color(0xFF9C5BD1), Color(0xFFCB5A7A),
    Color(0xFFCC7A2B), Color(0xFF2E9E83), Color(0xFF5A8F3C), Color(0xFF3E8EA6),
)

fun avatarColor(key: String): Color =
    avatarPalette[key.hashCode().absoluteValue % avatarPalette.size]

/** Format a transcript timestamp (epoch millis) as HH:mm in local time. */
private val hhmm: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

fun formatTime(epochMillis: Long?): String? = epochMillis?.let {
    runCatching {
        Instant.ofEpochMilli(it).atZone(ZoneId.systemDefault()).toLocalTime().format(hhmm)
    }.getOrNull()
}
