import SwiftUI
import HerdrKit
#if canImport(UIKit)
import UIKit
#endif

/// One workspace conversation. Native anatomy end to end: system background,
/// tail-on-last bubble runs, a QuickType-style blocked row, and an iMessage
/// composer (send button inside the field). The view model lives in the
/// app-scoped `ThreadSessions` registry, so navigating away keeps the session
/// alive and coming back is instant.
struct ChatThreadView: View {
    @State private var model: ChatThreadViewModel
    @State private var sendTrigger = 0

    init(client: HerdrClient, connectionID: String, summary: ChatSummary) {
        _model = State(initialValue: ThreadSessions.shared.model(
            connectionID: connectionID, summary: summary, client: client
        ))
    }

    /// Bubbles worth showing: hide sidechain chatter and raw tool-result turns.
    private var visibleMessages: [ChatMessage] {
        model.messages.filter { !$0.isSidechain && !($0.role == .user && $0.isToolOnly) }
    }

    /// True while we're waiting on the agent — it's working, or a send is still
    /// being submitted/verified — but not when it's blocked (the quick-reply bar
    /// covers that). Drives the slim waiting bar under the newest bubble.
    private var isWaiting: Bool {
        !model.isBlocked && (model.status == .working || model.isSending)
    }

    var body: some View {
        VStack(spacing: 0) {
            messageList
            if model.isBlocked {
                BlockedReplyBar { keys in
                    Task { await model.sendKeys(keys) }
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            if let error = model.error {
                errorRow(error)
            }
            composer
        }
        .background(Theme.background)
        .animation(.spring(response: 0.35, dampingFraction: 0.9), value: model.isBlocked)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .principal) { header }
        }
        .task { model.startIfNeeded() }
        .onAppear {
            UnreadStore.shared.activeKey = model.unreadKey
            UnreadStore.shared.clear(model.unreadKey)
        }
        .onDisappear {
            if UnreadStore.shared.activeKey == model.unreadKey {
                UnreadStore.shared.activeKey = nil
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(spacing: 1) {
            Text(model.title)
                .font(.headline)
            statusSubtitle
        }
    }

    @ViewBuilder
    private var statusSubtitle: some View {
        let status = model.status
        let text: String? = switch status {
        case .working: "yazıyor"
        case .blocked: "yanıt bekliyor"
        case .done: "bitti"
        case .idle: "çevrimiçi"
        case .unknown: nil
        }
        if let text {
            HStack(spacing: 4) {
                Circle()
                    .fill(Theme.statusColor(status))
                    .frame(width: 6, height: 6)
                Text(text)
                    .font(.caption2)
                    .foregroundStyle(status == .blocked ? Theme.attention : Color.secondary)
                if status == .working { TypingDots(color: Theme.tint, size: 3.5) }
            }
        }
    }

    // MARK: - Messages

    /// A chronological row, precomputed so the flipped list stays simple.
    private struct Row: Identifiable {
        let message: ChatMessage
        let startsGroup: Bool
        let endsGroup: Bool
        var id: String { message.id }
    }

    private var rows: [Row] {
        let visible = visibleMessages
        return visible.enumerated().map { index, message in
            let prev = index > 0 ? visible[index - 1] : nil
            let next = index + 1 < visible.count ? visible[index + 1] : nil
            return Row(
                message: message,
                startsGroup: prev == nil || prev!.role != message.role || prev!.agentLabel != message.agentLabel,
                endsGroup: next == nil || next!.role != message.role || next!.agentLabel != message.agentLabel
            )
        }
    }

    /// Chronological list anchored to the BOTTOM (`defaultScrollAnchor`): every
    /// open lands on the newest message, and while the reader stays at the
    /// bottom, incoming messages keep the view pinned there — scrolled-up
    /// readers are never yanked. No flipped-transform tricks: those broke
    /// scroll restoration and made iOS 26's scroll-edge blur cover the screen.
    private var messageList: some View {
        ScrollView {
            if rows.isEmpty && !isWaiting {
                ContentUnavailableView(
                    "Henüz mesaj yok",
                    systemImage: "text.bubble",
                    description: Text("İlk mesajını yaz — \(model.title) hazır.")
                )
                .padding(.vertical, 80)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(rows) { row in
                        rowView(row)
                            .padding(.top, row.startsGroup ? 10 : 2)
                    }
                    // While waiting on the agent, a slim sweeping bar sits at the
                    // very bottom, under the newest bubble.
                    if isWaiting {
                        WaitingBar()
                            .padding(.horizontal, 44)
                            .padding(.top, 16)
                            .padding(.bottom, 4)
                            .transition(.opacity)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: isWaiting)
        .defaultScrollAnchor(.bottom)
        #if os(iOS)
        .scrollDismissesKeyboard(.immediately)
        #endif
    }

    @ViewBuilder
    private func rowView(_ row: Row) -> some View {
        let failed = model.failedEchoIDs.contains(row.message.id)
        VStack(alignment: .leading, spacing: 2) {
            if row.startsGroup, let label = row.message.agentLabel, row.message.role != .user {
                Text(label)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.secondary)
                    .padding(.leading, 14)
            }
            MessageBubble(message: row.message, isLastInGroup: row.endsGroup)
                .contextMenu {
                    Button {
                        copyToPasteboard(row.message.displayText)
                    } label: {
                        Label("Kopyala", systemImage: "doc.on.doc")
                    }
                }
            if failed {
                retryRow(for: row.message.id)
            }
        }
    }

    private func retryRow(for echoID: String) -> some View {
        HStack {
            Spacer()
            Button {
                Task { await model.retry(echoID: echoID) }
            } label: {
                Label("Gönderilemedi — tekrar dene", systemImage: "exclamationmark.arrow.circlepath")
                    .font(.caption)
                    .foregroundStyle(Theme.attention)
            }
            .buttonStyle(.plain)
        }
    }

    private func errorRow(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Theme.attention)
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Spacer()
            Button {
                model.clearError()
            } label: {
                Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.bar)
    }

    // MARK: - Composer (floating glass capsule, iMessage-style)

    /// A single floating pill that hovers above the keyboard: a frosted-glass
    /// capsule with the send button inside on the trailing edge. No full-width
    /// bar behind it — the pill sits on the chat background with breathing room
    /// on every side, so there's no flat edge trying (and failing) to meet the
    /// keyboard's rounded top.
    private var composer: some View {
        let canSend = !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.isSending
        return HStack(alignment: .bottom, spacing: 6) {
            TextField("Mesaj", text: $model.draft, axis: .vertical)
                .lineLimit(1...5)
                .padding(.leading, 16)
                .padding(.vertical, 9)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                sendTrigger += 1
                Task { await model.send() }
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(canSend ? Theme.tint : Color.secondary.opacity(0.4))
                    .symbolRenderingMode(.hierarchical)
            }
            .buttonStyle(PressableStyle())
            .disabled(!canSend)
            .padding(.trailing, 5)
            .padding(.bottom, 4)
            .animation(.spring(response: 0.25, dampingFraction: 1), value: canSend)
            .sendHaptic(sendTrigger)
        }
        .background(
            ZStack {
                Capsule(style: .continuous).fill(.regularMaterial)
                Capsule(style: .continuous)
                    .strokeBorder(Theme.separator.opacity(0.35), lineWidth: 0.5)
            }
        )
        .padding(.horizontal, 10)
        .padding(.top, 6)
        .padding(.bottom, 8)
    }

    private func copyToPasteboard(_ text: String) {
        #if canImport(UIKit)
        UIPasteboard.general.string = text
        #endif
    }
}

private extension View {
    /// Medium impact haptic on send (iOS only; no-op elsewhere).
    @ViewBuilder func sendHaptic(_ trigger: Int) -> some View {
        #if os(iOS)
        self.sensoryFeedback(.impact(weight: .medium), trigger: trigger)
        #else
        self
        #endif
    }
}
