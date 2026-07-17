import SwiftUI
import HerdrKit

/// One workspace conversation: transcript bubbles, a blocked quick-reply bar
/// when the agent is waiting, and a message input.
struct ChatThreadView: View {
    @State private var model: ChatThreadViewModel
    @State private var sendTrigger = 0
    @Environment(\.colorScheme) private var scheme

    init(client: HerdrClient, summary: ChatSummary) {
        _model = State(initialValue: ChatThreadViewModel(client: client, summary: summary))
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
            inputBar
        }
        .background(Theme.background(scheme))
        .animation(.spring(response: 0.35, dampingFraction: 0.9), value: model.isBlocked)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.headerGreen, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        #endif
        .toolbar {
            ToolbarItem(placement: .principal) { header }
        }
        .task { model.start() }
        .onDisappear { model.stop() }
    }

    private var header: some View {
        VStack(spacing: 1) {
            Text(model.title)
                .font(.headline)
                .foregroundStyle(.white)
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
                Text(text).font(.caption2).foregroundStyle(.white.opacity(0.85))
                if status == .working { TypingDots(color: .white.opacity(0.85), size: 3.5) }
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
                        MessageBubble(message: message, groupedWithPrev: grouped)
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
