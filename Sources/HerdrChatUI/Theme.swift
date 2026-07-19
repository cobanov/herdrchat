import SwiftUI
import HerdrKit
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Native-first palette. Every surface comes from the SYSTEM so the app sits
/// naturally next to first-party iOS apps (and adapts to dark mode for free);
/// the only brand ink is an emerald tint — deliberately neither iMessage blue
/// nor WhatsApp green, a quiet nod to terminal green. Attention rides system
/// orange, the platform's own "needs you" colour.
public enum Theme {
    /// Brand tint: outgoing bubbles, send button, working presence, app tint.
    public static let tint = Color(hex: 0x2EA26A)
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
