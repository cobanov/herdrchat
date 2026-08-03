package dev.herdr.herdrchat.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import dev.herdr.herdrchat.core.model.AgentStatus

/** Palette drawn from the app logo (herdrchat.png): a deep indigo-navy base and
 *  a periwinkle-lavender accent, resolved per color scheme. */
object HerdrColors {
    // Brand — the two logo colours plus a mid periwinkle for contrast on light.
    val ink = Color(0xFF1F1D2A)        // logo background (deep indigo-navy)
    val lavender = Color(0xFFC3C7F9)   // logo foreground (light periwinkle)
    val indigo = Color(0xFF6E74E6)     // mid periwinkle — readable on light + dark

    val accent = indigo
    val headerGreen = ink              // top bar = logo dark (name kept to limit churn)
    val headerGreenDark = Color(0xFF17151F)

    fun background(dark: Boolean) = if (dark) ink else Color(0xFFF3F2FB)
    fun incomingBubble(dark: Boolean) = if (dark) Color(0xFF2A2838) else Color(0xFFFFFFFF)
    fun outgoingBubble(dark: Boolean) = if (dark) Color(0xFF3B3A66) else Color(0xFFE4E5FB)
    fun primaryText(dark: Boolean) = if (dark) Color(0xFFECEDFA) else Color(0xFF1B1A26)
    fun secondaryText(dark: Boolean) = if (dark) Color(0xFF9A98B4) else Color(0xFF6A687F)

    /** Presence/attention colour for an agent status. */
    fun statusColor(status: AgentStatus) = when (status) {
        AgentStatus.WORKING -> Color(0xFF8A8FF2)  // periwinkle "typing"
        AgentStatus.BLOCKED -> Color(0xFFF0A23D)  // warm amber — needs you (stands out)
        AgentStatus.DONE -> accent
        AgentStatus.IDLE -> Color(0xFF8E8CA8)
        AgentStatus.UNKNOWN -> Color(0xFF8E8CA8)
    }
}

@Composable
fun HerdrTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val scheme = if (dark) {
        darkColorScheme(
            primary = HerdrColors.indigo,
            secondary = HerdrColors.lavender,
            background = HerdrColors.background(true),
            surface = HerdrColors.incomingBubble(true),
        )
    } else {
        lightColorScheme(
            primary = HerdrColors.indigo,
            secondary = HerdrColors.lavender,
            background = HerdrColors.background(false),
            surface = Color(0xFFFFFFFF),
        )
    }
    MaterialTheme(colorScheme = scheme, content = content)
}
