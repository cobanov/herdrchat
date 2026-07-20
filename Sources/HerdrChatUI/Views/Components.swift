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
            TerminalChip(glyph: "…", label: "thought", glyphColor: .secondary)
        case .toolUse(let name, let input):
            TerminalChip(glyph: "❯", label: input.map { "\(name) \($0)" } ?? name, glyphColor: Theme.tint, expandable: input != nil)
        case .toolResult:
            TerminalChip(glyph: "✓", label: "tool result", glyphColor: .secondary)
        }
    }
}

/// Tool activity as a terminal token: monospaced, quiet, unmistakably CLI. When
/// `expandable`, tapping toggles between a one-line preview and the full text, so
/// a long tool call can be read in place instead of staying truncated.
private struct TerminalChip: View {
    let glyph: String
    let label: String
    let glyphColor: Color
    var expandable: Bool = false
    @State private var expanded = false

    var body: some View {
        HStack(alignment: .top, spacing: 5) {
            Text(glyph)
                .font(.system(.caption2, design: .monospaced).weight(.bold))
                .foregroundStyle(glyphColor)
            Text(label)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(expandable && expanded ? nil : 1)
                .textSelection(.enabled)
            if expandable {
                Image(systemName: expanded ? "chevron.up" : "chevron.down")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(Theme.fillSubtle)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture {
            guard expandable else { return }
            withAnimation(.easeInOut(duration: 0.15)) { expanded.toggle() }
        }
    }
}

// MARK: - Live preview (agent's in-progress answer)

/// A dim trailing bubble showing the agent's answer as it's being written
/// (scraped from the pane's visible screen). Superseded by the real bubble when
/// the turn settles. Only shown when clean prose was extracted — otherwise the
/// waiting bar shows instead.
struct LivePreviewBubble: View {
    let text: String

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    TypingDots(color: Theme.tint, size: 4)
                    Text("live")
                        .font(.system(.caption2, design: .rounded).weight(.semibold))
                        .foregroundStyle(Theme.tint)
                }
                Text(text)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Theme.bubbleIncoming.opacity(0.6))
            .clipShape(
                UnevenRoundedRectangle(topLeadingRadius: 5, bottomLeadingRadius: 18, bottomTrailingRadius: 18, topTrailingRadius: 18, style: .continuous)
            )
            .frame(maxWidth: 300, alignment: .leading)
            Spacer(minLength: 48)
        }
    }
}

// MARK: - Waiting indicator

/// A slim, indeterminate "waiting for the reply" bar shown while the agent
/// works. Transcripts are turn-granular, so there's no finer token stream to
/// surface — a quiet sweeping bar reads as progress without pretending to show
/// content it doesn't have (it replaces the old terminal-tail bubble).
struct WaitingBar: View {
    var height: CGFloat = 3

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let segment = max(48, w * 0.28)
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.tint.opacity(0.14))
                TimelineView(.animation) { context in
                    let t = context.date.timeIntervalSinceReferenceDate
                    // Ease-in-out sweep back and forth across the track.
                    let phase = 0.5 - 0.5 * cos(t * 1.5)
                    let x = (w - segment) * phase
                    Capsule()
                        .fill(Theme.tint)
                        .frame(width: segment)
                        .offset(x: x)
                }
            }
        }
        .frame(height: height)
        .clipShape(Capsule())
        .accessibilityLabel("Waiting for reply")
    }
}

// MARK: - Blocked quick replies

/// Shown when an agent is waiting for input. When the pane's choice menu could
/// be parsed, it shows the actual question and one full-width button per option
/// labelled with its real text (e.g. "2. Yes, and don't ask again"), so you can
/// see what you're picking. Otherwise it falls back to generic QuickType chips.
struct BlockedReplyBar: View {
    /// Parsed choice menu from the blocked pane, if any.
    var prompt: BlockedPrompt?
    let onKeys: ([String]) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let prompt, !prompt.isEmpty {
                labelledOptions(prompt)
            } else {
                genericChips
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.bar)
    }

    @ViewBuilder
    private func labelledOptions(_ prompt: BlockedPrompt) -> some View {
        Label(prompt.question ?? "Agent is waiting", systemImage: "exclamationmark.bubble.fill")
            .font(.footnote.weight(.medium))
            .foregroundStyle(Theme.attention)
            .fixedSize(horizontal: false, vertical: true)
        ForEach(prompt.options) { option in
            Button {
                onKeys(option.keys)
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(option.number)")
                        .font(.footnote.weight(.bold).monospacedDigit())
                        .foregroundStyle(Theme.attention)
                        .frame(minWidth: 16, alignment: .trailing)
                    Text(option.label)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Theme.attention.opacity(0.12))
                )
            }
            .buttonStyle(PressableStyle())
        }
    }

    private var genericChips: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label("Agent is waiting", systemImage: "exclamationmark.bubble.fill")
                .font(.footnote.weight(.medium))
                .foregroundStyle(Theme.attention)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    chip("Confirm", icon: "return", keys: ["Enter"])
                    chip("1", keys: ["1", "Enter"])
                    chip("2", keys: ["2", "Enter"])
                    chip("Esc", icon: "escape", keys: ["Escape"])
                }
            }
        }
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
