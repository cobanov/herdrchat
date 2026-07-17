import SwiftUI
import Foundation
import HerdrKit

/// Small coloured presence dot; pulses a soft ring while working/blocked.
struct PresenceDot: View {
    let status: AgentStatus
    var ring: Color = .clear
    @State private var animate = false

    var body: some View {
        let color = Theme.statusColor(status)
        let pulsing = status == .working || status == .blocked
        ZStack {
            if pulsing {
                Circle()
                    .fill(color)
                    .frame(width: 10, height: 10)
                    .scaleEffect(animate ? 2.4 : 1)
                    .opacity(animate ? 0 : 0.45)
            }
            Circle()
                .fill(ring)
                .frame(width: 11, height: 11)
                .overlay(Circle().fill(color).frame(width: 8, height: 8))
        }
        .frame(width: 14, height: 14)
        .onAppear {
            if pulsing {
                withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) { animate = true }
            }
        }
    }
}

/// Three bouncing dots for a "typing…" indicator, driven by the display clock.
struct TypingDots: View {
    var color: Color
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

/// A single chat bubble. Outgoing (user) hugs the right; agent bubbles the left.
/// WhatsApp-style asymmetric corner on the first bubble of a run.
struct MessageBubble: View {
    let message: ChatMessage
    var groupedWithPrev: Bool = false
    @Environment(\.colorScheme) private var scheme

    private var isOutgoing: Bool { message.role == .user }

    var body: some View {
        HStack {
            if isOutgoing { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 5) {
                if let label = message.agentLabel, !isOutgoing, !groupedWithPrev {
                    Text(label)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Theme.headerGreen)
                }
                ForEach(Array(message.segments.enumerated()), id: \.offset) { _, segment in
                    segmentView(segment)
                }
                if let time = formatTime(message.timestamp) {
                    Text(time)
                        .font(.caption2)
                        .foregroundStyle(Theme.secondaryText(scheme).opacity(0.8))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(isOutgoing ? Theme.outgoingBubble(scheme) : Theme.incomingBubble(scheme))
            .clipShape(bubbleShape)
            .shadow(color: .black.opacity(scheme == .dark ? 0.25 : 0.08), radius: 1.5, x: 0, y: 1)
            .frame(maxWidth: 320, alignment: isOutgoing ? .trailing : .leading)
            if !isOutgoing { Spacer(minLength: 40) }
        }
    }

    private var bubbleShape: UnevenRoundedRectangle {
        let r: CGFloat = 17
        let tail: CGFloat = 5
        if isOutgoing {
            return UnevenRoundedRectangle(
                topLeadingRadius: r,
                bottomLeadingRadius: r,
                bottomTrailingRadius: r,
                topTrailingRadius: groupedWithPrev ? r : tail,
                style: .continuous
            )
        } else {
            return UnevenRoundedRectangle(
                topLeadingRadius: groupedWithPrev ? r : tail,
                bottomLeadingRadius: r,
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
            Text(text)
                .font(.body)
                .foregroundStyle(Theme.primaryText(scheme))
                .textSelection(.enabled)
        case .thinking:
            chip(icon: "brain", label: "düşündü", tint: Theme.secondaryText(scheme))
        case .toolUse(let name, let input):
            chip(icon: "wrench.and.screwdriver", label: input.map { "\(name): \($0)" } ?? name, tint: Theme.headerGreen)
        case .toolResult:
            chip(icon: "checkmark.seal", label: "araç sonucu", tint: Theme.secondaryText(scheme))
        }
    }

    private func chip(icon: String, label: String, tint: Color) -> some View {
        Label {
            Text(label).lineLimit(1)
        } icon: {
            Image(systemName: icon)
        }
        .font(.caption)
        .foregroundStyle(tint)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(tint.opacity(0.12))
        .clipShape(Capsule())
    }
}

/// Quick-reply bar shown when an agent is blocked, waiting for input.
struct BlockedReplyBar: View {
    let onKeys: ([String]) -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                TypingDots(color: Theme.statusColor(.blocked), size: 4)
                Text("Agent yanıt bekliyor")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.statusColor(.blocked))
            }
            HStack(spacing: 8) {
                replyButton("Onayla", ["Enter"])
                replyButton("1", ["1", "Enter"])
                replyButton("2", ["2", "Enter"])
                replyButton("Esc", ["Escape"])
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity)
        .background(Theme.statusColor(.blocked).opacity(scheme == .dark ? 0.14 : 0.10))
    }

    private func replyButton(_ title: String, _ keys: [String]) -> some View {
        Button {
            onKeys(keys)
        } label: {
            Text(title)
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 16)
                .padding(.vertical, 9)
                .background(Theme.incomingBubble(scheme))
                .foregroundStyle(Theme.primaryText(scheme))
                .clipShape(Capsule())
        }
        .buttonStyle(PressableStyle())
    }
}
