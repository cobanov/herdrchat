package dev.herdr.herdrchat.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import dev.herdr.herdrchat.core.model.AgentStatus

/** WhatsApp-flavoured palette, resolved per color scheme. */
object HerdrColors {
    val accent = Color(0xFF25D366)
    val headerGreen = Color(0xFF128C7E)
    val headerGreenDark = Color(0xFF0B6E58)

    fun background(dark: Boolean) = if (dark) Color(0xFF0B141A) else Color(0xFFECE5DD)
    fun incomingBubble(dark: Boolean) = if (dark) Color(0xFF202C33) else Color(0xFFFFFFFF)
    fun outgoingBubble(dark: Boolean) = if (dark) Color(0xFF005C4B) else Color(0xFFD9FDD3)
    fun primaryText(dark: Boolean) = if (dark) Color(0xFFE9EDEF) else Color(0xFF111B21)
    fun secondaryText(dark: Boolean) = if (dark) Color(0xFF8696A0) else Color(0xFF667781)

    /** Presence/attention colour for an agent status. */
    fun statusColor(status: AgentStatus) = when (status) {
        AgentStatus.WORKING -> Color(0xFF34B7F1)  // "typing" blue
        AgentStatus.BLOCKED -> Color(0xFFF15C6D)  // needs-you red
        AgentStatus.DONE -> accent
        AgentStatus.IDLE -> Color(0xFF8696A0)
        AgentStatus.UNKNOWN -> Color(0xFF8696A0)
    }
}

@Composable
fun HerdrTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val scheme = if (dark) {
        darkColorScheme(
            primary = HerdrColors.accent,
            secondary = HerdrColors.headerGreen,
            background = HerdrColors.background(true),
            surface = HerdrColors.incomingBubble(true),
        )
    } else {
        lightColorScheme(
            primary = HerdrColors.headerGreen,
            secondary = HerdrColors.accent,
            background = HerdrColors.background(false),
            surface = Color(0xFFFFFFFF),
        )
    }
    MaterialTheme(colorScheme = scheme, content = content)
}
