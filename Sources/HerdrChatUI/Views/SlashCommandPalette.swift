import SwiftUI
import HerdrKit

/// The command palette that appears when a draft starts with `/`, mirroring what
/// Claude Code shows in the terminal.
///
/// Tapping a row INSERTS the command and leaves it in the composer rather than
/// sending it — exactly what selecting from the terminal palette does. That keeps
/// one predictable rule instead of a per-command guess about whether it takes
/// arguments, and `/model sonnet` stays possible by simply typing on.
struct SlashCommandPalette: View {
    let commands: [SlashCommand]
    let onPick: (SlashCommand) -> Void

    /// Roughly three rows before scrolling — tall enough to browse, short enough
    /// to leave the conversation visible behind it.
    private static let maxHeight: CGFloat = 232

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(commands) { command in
                    Button {
                        onPick(command)
                    } label: {
                        row(command)
                    }
                    .buttonStyle(PressableStyle())
                    if command.id != commands.last?.id {
                        Divider().padding(.leading, 14)
                    }
                }
            }
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(maxHeight: Self.maxHeight)
        .paletteGlass()
    }

    private func row(_ command: SlashCommand) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(command.invocation)
                    .font(.system(.subheadline, design: .monospaced).weight(.semibold))
                    .foregroundStyle(Theme.tint)
                Spacer(minLength: 4)
                Text(command.source.badge)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            if let summary = command.summary {
                Text(summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
}

private extension View {
    /// The palette's surface: a floating control panel, so it takes Liquid Glass
    /// on iOS 26 in the same rounded rect as the reply bar it stacks above.
    @ViewBuilder
    func paletteGlass() -> some View {
        #if os(iOS)
        if #available(iOS 26, *) {
            self.glassEffect(.regular, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        } else {
            self.paletteMaterialFallback()
        }
        #else
        self.paletteMaterialFallback()
        #endif
    }

    func paletteMaterialFallback() -> some View {
        let shape = RoundedRectangle(cornerRadius: 22, style: .continuous)
        return self
            .background(shape.fill(.regularMaterial))
            .overlay(shape.strokeBorder(Theme.separator.opacity(0.35), lineWidth: 0.5))
            .clipShape(shape)
    }
}
