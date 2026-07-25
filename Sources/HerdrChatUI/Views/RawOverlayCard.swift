import SwiftUI
import HerdrKit

/// The escape hatch for overlays that have no rows to tap — `/resume` is a search
/// box over a list, driven by typing and arrow keys.
///
/// Rather than pretend those can be turned into buttons, this shows the agent's
/// screen verbatim and gives you the keys to drive it. It is what keeps every
/// command in the palette completable instead of some of them being dead ends.
struct RawOverlayCard: View {
    let screen: String
    let title: String?
    /// Keys the overlay's footer advertised (Ctrl chords and the like).
    let actions: [OverlayAction]
    let onKeys: ([String]) -> Void

    /// Enough rows to see a list and its search box without taking the screen.
    private static let maxHeight: CGFloat = 190

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            terminal
            keypad
            if !actions.isEmpty {
                footerChips
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .rawOverlayGlass()
    }

    private var header: some View {
        HStack(spacing: 6) {
            Image(systemName: "terminal")
                .font(.caption)
            Text(title ?? "Terminal")
                .font(.footnote.weight(.medium))
                .lineLimit(1)
            Spacer(minLength: 0)
            Text("type to search")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .foregroundStyle(Theme.tint)
    }

    /// The pane's own output. Monospaced and horizontally scrollable, because this
    /// is terminal text whose alignment carries meaning — reflowing it would make
    /// a list unreadable.
    private var terminal: some View {
        ScrollView([.vertical, .horizontal]) {
            Text(screen)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.primary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(maxHeight: Self.maxHeight)
        .padding(8)
        .background(Theme.fillSubtle, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    /// Arrows, confirm and cancel. Always offered: `/resume` documents its Ctrl
    /// chords but never mentions the arrow keys it is actually navigated with, so
    /// reading the footer alone would leave the list unusable.
    private var keypad: some View {
        HStack(spacing: 8) {
            ForEach(PaneOverlayDetector.navigationActions) { action in
                Button {
                    onKeys(action.keys)
                } label: {
                    Text(action.key)
                        .font(.footnote.weight(.semibold))
                        .frame(minWidth: 34)
                        .padding(.vertical, 2)
                }
                .chipStyle()
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .tint(Theme.tint)
                .accessibilityLabel(action.detail)
            }
            Spacer(minLength: 0)
        }
    }

    private var footerChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(actions) { action in
                    Button {
                        onKeys(action.keys)
                    } label: {
                        HStack(spacing: 4) {
                            Text(action.key)
                                .font(.caption2.weight(.bold).monospaced())
                            Text(action.detail)
                                .font(.caption)
                                .lineLimit(1)
                        }
                    }
                    .chipStyle()
                    .buttonBorderShape(.capsule)
                    .controlSize(.small)
                    .tint(Theme.tint)
                }
            }
        }
    }
}

private extension View {
    @ViewBuilder
    func rawOverlayGlass() -> some View {
        #if os(iOS)
        if #available(iOS 26, *) {
            self.glassEffect(.regular, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        } else {
            self.background(.bar, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        #else
        self.background(.bar, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        #endif
    }
}
