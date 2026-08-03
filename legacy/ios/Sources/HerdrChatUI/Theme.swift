import SwiftUI
import HerdrKit
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Native-first palette. Every surface comes from the SYSTEM so the app sits
/// naturally next to first-party iOS apps (and adapts to dark mode for free);
/// the brand ink is a periwinkle tint drawn from the app logo (indigo-navy +
/// lavender). Attention rides system orange, the platform's own "needs you"
/// colour, which also pops against the cool blue tint.
public enum Theme {
    /// Brand tint: outgoing bubbles, send button, working presence, app tint.
    /// A mid periwinkle from the logo's blue — legible on light and dark.
    public static let tint = Color(hex: 0x6E74E6)
    /// The logo's light periwinkle, for accents that sit on dark surfaces.
    public static let lavender = Color(hex: 0xC3C7F9)
    /// A blocked agent needs the user — system orange, not alarm red.
    public static let attention = Color.orange

    // MARK: - System surfaces (platform-bridged so the package builds on macOS)

    public static var background: Color {
        #if canImport(UIKit)
        Color(uiColor: .systemBackground)
        #else
        Color(nsColor: .windowBackgroundColor)
        #endif
    }

    /// Incoming bubble / inset surfaces.
    public static var bubbleIncoming: Color {
        #if canImport(UIKit)
        Color(uiColor: .secondarySystemBackground)
        #else
        Color(nsColor: .underPageBackgroundColor)
        #endif
    }

    /// Subtle fills: tool chips, inactive send.
    public static var fillSubtle: Color {
        #if canImport(UIKit)
        Color(uiColor: .tertiarySystemFill)
        #else
        Color(nsColor: .quaternaryLabelColor).opacity(0.4)
        #endif
    }

    /// Hairline strokes (input field border).
    public static var separator: Color {
        #if canImport(UIKit)
        Color(uiColor: .separator)
        #else
        Color(nsColor: .separatorColor)
        #endif
    }

    /// Presence/attention colour for an agent status.
    public static func statusColor(_ status: AgentStatus) -> Color {
        switch status {
        case .working: return tint
        case .blocked: return attention
        case .done: return tint
        case .idle, .unknown: return .secondary
        }
    }
}

public extension Color {
    /// 0xRRGGBB literal to Color, sRGB.
    init(hex: UInt) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}
