import SwiftUI
import Foundation
import HerdrKit

// MARK: - Signature: presence ring avatar

/// The app's one signature element: a workspace avatar wrapped in a thin ring
/// that *breathes* in emerald while the agent works and holds solid orange when
/// it's waiting on you — a terminal cursor's blink, translated to iOS. Idle
/// workspaces show no ring at all, so attention goes exactly where it should.
struct PresenceRingAvatar: View {
    let title: String
    let key: String
    let status: AgentStatus
    var size: CGFloat = 52

    private var ring: Color? {
        switch status {
        case .working: return Theme.tint
        case .blocked: return Theme.attention
        case .done: return Theme.tint.opacity(0.45)
        case .idle, .unknown: return nil
        }
    }

    var body: some View {
        ZStack {
            if let ring {
                if status == .working {
                    TimelineView(.animation) { context in
                        let t = context.date.timeIntervalSinceReferenceDate
                        Circle()
                            .strokeBorder(ring, lineWidth: 2)
                            .opacity(0.35 + 0.65 * (0.5 + 0.5 * sin(t * 2.4)))
                    }
                } else {
                    Circle().strokeBorder(ring, lineWidth: 2)
                }
            }
            Circle()
                .fill(Avatar.color(for: key))
                .frame(width: size, height: size)
                .overlay(
                    Text(initials(of: title))
                        .font(.system(size: size * 0.36, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white)
                )
        }
        .frame(width: size + 8, height: size + 8)
    }
}

func initials(of title: String) -> String {
    let letters = title.split(separator: " ").compactMap(\.first).prefix(2)
    return letters.isEmpty ? "?" : String(letters).uppercased()
}

// MARK: - Typing indicator

/// Three softly pulsing dots, driven by the display clock.
struct TypingDots: View {
    var color: Color = .secondary
    var size: CGFloat = 5

    var body: some View {
        TimelineView(.animation) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 3) {
                ForEach(0..<3, id: \.self) { i in
                    let phase = sin(t * 5 - Double(i) * 0.9)
                    Circle()
                        .fill(color)
                        .frame(width: size, height: size)
                        .opacity(0.3 + 0.7 * (phase * 0.5 + 0.5))
                }
            }
        }
        .frame(height: size)
    }
}

// MARK: - Message bubble

/// A native-feeling chat bubble: 18pt continuous corners, no shadow, system
/// surfaces. Following the iMessage convention, only the LAST bubble of a run
/// gets the small "tail" corner; bubbles inside a run stay fully rounded.
struct MessageBubble: View {
    let message: ChatMessage
    var isLastInGroup: Bool = true

    private var isOutgoing: Bool { message.role == .user }

    var body: some View {
        HStack {
            if isOutgoing { Spacer(minLength: 48) }
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(message.segments.enumerated()), id: \.offset) { _, segment in
                    segmentView(segment)
                }
                if isLastInGroup, let time = formatTime(message.timestamp) {
                    Text(time)
                        .font(.caption2)
                        .foregroundStyle(isOutgoing ? Color.white.opacity(0.7) : Color.secondary.opacity(0.8))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(isOutgoing ? Theme.tint : Theme.bubbleIncoming)
            .clipShape(bubbleShape)
            .frame(maxWidth: 300, alignment: isOutgoing ? .trailing : .leading)
            if !isOutgoing { Spacer(minLength: 48) }
        }
    }

    private var bubbleShape: UnevenRoundedRectangle {
        let r: CGFloat = 18
        let tail: CGFloat = 5
        if isOutgoing {
            return UnevenRoundedRectangle(
                topLeadingRadius: r,
                bottomLeadingRadius: r,
                bottomTrailingRadius: isLastInGroup ? tail : r,
                topTrailingRadius: r,
                style: .continuous
            )
        } else {
            return UnevenRoundedRectangle(
                topLeadingRadius: r,
                bottomLeadingRadius: isLastInGroup ? tail : r,
                bottomTrailingRadius: r,
                topTrailingRadius: r,
                style: .continuous
            )
        }
    }

    @ViewBuilder
    private func segmentView(_ segment: MessageSegment) -> some View {
        switch segment {
        case .text(let text):
            MarkdownText(markdown: text, foreground: isOutgoing ? .white : .primary, onTint: isOutgoing)
                .font(.body)
                .textSelection(.enabled)
        case .thinking:
            terminalChip(glyph: "…", label: "düşündü", glyphColor: .secondary)
        case .toolUse(let name, let input):
            terminalChip(glyph: "❯", label: input.map { "\(name) \($0)" } ?? name, glyphColor: Theme.tint)
        case .toolResult:
            terminalChip(glyph: "✓", label: "araç sonucu", glyphColor: .secondary)
        }
    }

    /// Tool activity as a terminal token: monospaced, quiet, unmistakably CLI.
    private func terminalChip(glyph: String, label: String, glyphColor: Color) -> some View {
        HStack(spacing: 5) {
            Text(glyph)
                .font(.system(.caption2, design: .monospaced).weight(.bold))
                .foregroundStyle(glyphColor)
            Text(label)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(Theme.fillSubtle)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

// MARK: - Blocked quick replies

/// Shown when an agent is waiting for input: a QuickType-style row of capsule
/// chips above the composer — the platform's own "suggested replies" pattern.
struct BlockedReplyBar: View {
    let onKeys: ([String]) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label("Agent yanıt bekliyor", systemImage: "exclamationmark.bubble.fill")
                .font(.footnote.weight(.medium))
                .foregroundStyle(Theme.attention)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    chip("Onayla", icon: "return", keys: ["Enter"])
                    chip("1", keys: ["1", "Enter"])
                    chip("2", keys: ["2", "Enter"])
                    chip("Esc", icon: "escape", keys: ["Escape"])
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.bar)
    }

    @ViewBuilder
    private func chip(_ title: String, icon: String? = nil, keys: [String]) -> some View {
        Button {
            onKeys(keys)
        } label: {
            if let icon {
                Label(title, systemImage: icon)
            } else {
                Text(title)
            }
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .controlSize(.small)
        .tint(Theme.attention)
    }
}
