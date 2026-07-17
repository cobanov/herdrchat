import SwiftUI
import HerdrKit

/// Small coloured presence dot for an agent status.
struct PresenceDot: View {
    let status: AgentStatus
    var body: some View {
        Circle()
            .fill(Theme.statusColor(status))
            .frame(width: 10, height: 10)
    }
}

/// A single chat bubble. Outgoing (user) bubbles hug the right; agent bubbles
/// the left. Tool activity and thinking render as compact chips.
struct MessageBubble: View {
    let message: ChatMessage
    @Environment(\.colorScheme) private var scheme

    private var isOutgoing: Bool { message.role == .user }

    var body: some View {
        HStack {
            if isOutgoing { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 6) {
                if let label = message.agentLabel, !isOutgoing {
                    Text(label)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Theme.headerGreen)
                }
                ForEach(Array(message.segments.enumerated()), id: \.offset) { _, segment in
                    segmentView(segment)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(isOutgoing ? Theme.outgoingBubble(scheme) : Theme.incomingBubble(scheme))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .frame(maxWidth: 320, alignment: isOutgoing ? .trailing : .leading)
            if !isOutgoing { Spacer(minLength: 40) }
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
            chip(icon: "wrench.and.screwdriver", label: input.map { "\(name): \($0)" } ?? name,
                 tint: Theme.headerGreen)
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
            Text("Agent yanıt bekliyor")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.statusColor(.blocked))
            HStack(spacing: 8) {
                replyButton("Onayla", keys: ["Enter"])
                replyButton("1", keys: ["1", "Enter"])
                replyButton("2", keys: ["2", "Enter"])
                replyButton("Esc", keys: ["Escape"])
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity)
        .background(Theme.statusColor(.blocked).opacity(0.10))
    }

    private func replyButton(_ title: String, keys: [String]) -> some View {
        Button(title) { onKeys(keys) }
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Theme.incomingBubble(scheme))
            .clipShape(Capsule())
    }
}
