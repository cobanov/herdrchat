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

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                if visibleMessages.isEmpty {
                    ContentUnavailableView(
                        "Henüz mesaj yok",
                        systemImage: "text.bubble",
                        description: Text("İlk mesajını yaz — \(model.title) hazır.")
                    )
                    .padding(.top, 80)
                } else {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(visibleMessages.enumerated()), id: \.element.id) { index, message in
                            let prev = index > 0 ? visibleMessages[index - 1] : nil
                            let next = index + 1 < visibleMessages.count ? visibleMessages[index + 1] : nil
                            let startsGroup = prev == nil || prev!.role != message.role || prev!.agentLabel != message.agentLabel
                            let endsGroup = next == nil || next!.role != message.role || next!.agentLabel != message.agentLabel
                            let failed = model.failedEchoIDs.contains(message.id)

                            VStack(alignment: .leading, spacing: 2) {
                                if startsGroup, let label = message.agentLabel, message.role != .user {
                                    Text(label)
                                        .font(.caption2.weight(.medium))
                                        .foregroundStyle(.secondary)
                                        .padding(.leading, 14)
                                }
                                MessageBubble(message: message, isLastInGroup: endsGroup)
                                    .contextMenu {
                                        Button {
                                            copyToPasteboard(message.displayText)
                                        } label: {
                                            Label("Kopyala", systemImage: "doc.on.doc")
                                        }
                                    }
                                if failed {
                                    retryRow(for: message.id)
                                }
                            }
                            .id(message.id)
                            .padding(.top, startsGroup ? 10 : 2)
                            .transition(.opacity.combined(with: .offset(y: 10)))
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .animation(.spring(response: 0.3, dampingFraction: 0.95), value: visibleMessages.count)
                }
            }
            .defaultScrollAnchor(.bottom)
            #if os(iOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
            .onChange(of: visibleMessages.count) {
                if let last = visibleMessages.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
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

    // MARK: - Composer (iMessage anatomy: send button inside the field)

    private var composer: some View {
        let canSend = !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.isSending
        return HStack(alignment: .bottom, spacing: 0) {
            HStack(alignment: .bottom, spacing: 4) {
                TextField("Mesaj", text: $model.draft, axis: .vertical)
                    .lineLimit(1...5)
                    .padding(.leading, 12)
                    .padding(.vertical, 7)
                Button {
                    sendTrigger += 1
                    Task { await model.send() }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 27))
                        .foregroundStyle(canSend ? Theme.tint : Color.secondary.opacity(0.45))
                        .symbolRenderingMode(.hierarchical)
                }
                .buttonStyle(PressableStyle())
                .disabled(!canSend)
                .padding(.trailing, 3)
                .padding(.bottom, 3)
                .animation(.spring(response: 0.25, dampingFraction: 1), value: canSend)
                .sendHaptic(sendTrigger)
            }
            .background(
                ZStack {
                    RoundedRectangle(cornerRadius: 19, style: .continuous)
                        .fill(Theme.background)
                    RoundedRectangle(cornerRadius: 19, style: .continuous)
                        .strokeBorder(Theme.separator.opacity(0.6), lineWidth: 0.7)
                }
            )
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.bar)
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
