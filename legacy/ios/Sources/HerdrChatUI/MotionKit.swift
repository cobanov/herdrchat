import SwiftUI

/// Tactile scale(0.96)-on-press for buttons, with an interruptible no-bounce spring.
struct PressableStyle: ButtonStyle {
    var scale: CGFloat = 0.96
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .animation(.spring(response: 0.3, dampingFraction: 1), value: configuration.isPressed)
    }
}

/// Stable, pleasant avatar colours derived from a key (workspace title).
enum Avatar {
    static let palette: [Color] = [
        Color(hex: 0x128C7E), Color(hex: 0x3B76C4), Color(hex: 0x9C5BD1), Color(hex: 0xCB5A7A),
        Color(hex: 0xCC7A2B), Color(hex: 0x2E9E83), Color(hex: 0x5A8F3C), Color(hex: 0x3E8EA6),
    ]
    /// djb2 over UTF-8 — stable across launches (unlike String.hashValue).
    static func color(for key: String) -> Color {
        var hash = 5381
        for byte in key.utf8 { hash = (hash &* 33) &+ Int(byte) }
        let index = ((hash % palette.count) + palette.count) % palette.count
        return palette[index]
    }
}

/// Format a transcript timestamp as HH:mm in local time.
func formatTime(_ date: Date?) -> String? {
    guard let date else { return nil }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "HH:mm"
    return formatter.string(from: date)
}
