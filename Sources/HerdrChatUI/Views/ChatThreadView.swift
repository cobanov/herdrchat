import SwiftUI
import HerdrKit
#if canImport(UIKit)
import UIKit
#endif

/// One workspace conversation: transcript bubbles, a blocked quick-reply bar
/// when the agent is waiting, and a message input. The view model lives in the
/// app-scoped `ThreadSessions` registry, so navigating away keeps the session
/// (tails + polling) alive and coming back is instant.
struct ChatThreadView: View {
    @State private var model: ChatThreadViewModel
    @State private var sendTrigger = 0
    @Environment(\.colorScheme) private var scheme

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
            inputBar
        }
        .background(Theme.background(scheme))
        .animation(.spring(response: 0.35, dampingFraction: 0.9), value: model.isBlocked)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .principal) { header }
        }
        .task { model.startIfNeeded() }
    }

    private var header: some View {
        VStack(spacing: 1) {
            Text(model.title)
                .font(.headline)
                .foregroundStyle(.primary)
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
            HStack(spacing: 5) {
                Text(text)
                    .font(.caption2)
                    .foregroundStyle(status == .blocked ? Theme.statusColor(.blocked) : .secondary)
                if status == .working { TypingDots(color: Theme.statusColor(.working), size: 3.5) }
            }
        }
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(Array(visibleMessages.enumerated()), id: \.element.id) { index, message in
                        let prev = index > 0 ? visibleMessages[index - 1] : nil
                        let grouped = prev != nil && prev!.role == message.role && prev!.agentLabel == message.agentLabel
                        let failed = model.failedEchoIDs.contains(message.id)
                        VStack(spacing: 2) {
                            MessageBubble(message: message, groupedWithPrev: grouped)
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
                        .padding(.top, grouped ? 2 : 8)
                        .transition(.opacity.combined(with: .offset(y: 12)))
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 12)
                .animation(.spring(response: 0.3, dampingFraction: 0.95), value: visibleMessages.count)
            }
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
                    .foregroundStyle(Theme.statusColor(.blocked))
            }
            .buttonStyle(.plain)
        }
    }

    private func errorRow(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Spacer()
            Button {
                model.clearError()
            } label: {
                Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.thinMaterial)
    }

    private var inputBar: some View {
        let canSend = !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.isSending
        return HStack(spacing: 10) {
            TextField("Mesaj", text: $model.draft, axis: .vertical)
                .lineLimit(1...5)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Theme.incomingBubble(scheme))
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))

            Button {
                sendTrigger += 1
                Task { await model.send() }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(canSend ? Theme.accent : Theme.secondaryText(scheme).opacity(0.4)))
                    .scaleEffect(canSend ? 1 : 0.85)
            }
            .buttonStyle(PressableStyle())
            .disabled(!canSend)
            .animation(.spring(response: 0.3, dampingFraction: 1), value: canSend)
            .sendHaptic(sendTrigger)
        }
        .padding(10)
        .background(.thinMaterial)
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
