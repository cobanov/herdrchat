import SwiftUI
import HerdrKit

/// WhatsApp-flavoured palette, resolved per color scheme. Kept platform-neutral
/// (no UIColor/NSColor) so the UI type-checks on macOS and runs on iOS.
public enum Theme {
    public static func background(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x0B141A) : Color(hex: 0xECE5DD)
    }
    public static func incomingBubble(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x202C33) : Color(hex: 0xFFFFFF)
    }
    public static func outgoingBubble(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x005C4B) : Color(hex: 0xD9FDD3)
    }
    public static func primaryText(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0xE9EDEF) : Color(hex: 0x111B21)
    }
    public static func secondaryText(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x8696A0) : Color(hex: 0x667781)
    }
    public static let accent = Color(hex: 0x25D366)
    public static let headerGreen = Color(hex: 0x128C7E)

    /// Presence/attention colour for an agent status.
    public static func statusColor(_ status: AgentStatus) -> Color {
        switch status {
        case .working: return Color(hex: 0x34B7F1)   // "typing" blue
        case .blocked: return Color(hex: 0xF15C6D)   // needs-you red
        case .done: return accent
        case .idle: return Color(hex: 0x8696A0)
        case .unknown: return Color(hex: 0x8696A0)
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
