import SwiftUI
import HerdrKit

/// One workspace conversation: transcript bubbles, a blocked quick-reply bar
/// when the agent is waiting, and a message input.
struct ChatThreadView: View {
    @State private var model: ChatThreadViewModel
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
            }
            inputBar
        }
        .background(Theme.background(scheme))
        .navigationTitle(model.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { model.start() }
        .onDisappear { model.stop() }
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(visibleMessages) { message in
                        MessageBubble(message: message).id(message.id)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 12)
            }
            .onChange(of: visibleMessages.count) {
                if let last = visibleMessages.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }

    private var inputBar: some View {
        HStack(spacing: 10) {
            TextField("Mesaj", text: $model.draft, axis: .vertical)
                .lineLimit(1...5)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Theme.incomingBubble(scheme))
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))

            Button {
                Task { await model.send() }
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(Theme.accent)
            }
            .disabled(model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isSending)
        }
        .padding(10)
        .background(.thinMaterial)
    }
}
