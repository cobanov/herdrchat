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
    @State private var atBottom = true
    @State private var didInitialScroll = false
    private let bottomAnchor = "herdrchat.bottom"

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
                BlockedReplyBar(prompt: model.blockedPrompt) { keys in
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
            #if os(iOS)
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    didInitialScroll = false   // re-anchor to newest after reload
                    Task { await model.reload() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 15, weight: .medium))
                }
                .accessibilityLabel("Refresh")
            }
            #endif
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
        let statusText: String? = switch status {
        case .working: "typing"
        case .blocked: "waiting for reply"
        case .done: "done"
        case .idle: "online"
        case .unknown: nil
        }
        // "Opus 4.8 · apptest · online" — model, working-folder, and live status.
        let parts = [model.sessionMeta?.modelDisplayName, model.workingDirName, statusText].compactMap { $0 }
        if !parts.isEmpty {
            HStack(spacing: 4) {
                Circle()
                    .fill(Theme.statusColor(status))
                    .frame(width: 6, height: 6)
                Text(parts.joined(separator: " · "))
                    .font(.caption2)
                    .foregroundStyle(status == .blocked ? Theme.attention : Color.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
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
        ScrollViewReader { proxy in
            ScrollView {
                if rows.isEmpty && !isWaiting {
                    ContentUnavailableView(
                        "No messages yet",
                        systemImage: "text.bubble",
                        description: Text("Send your first message — \(model.title) is ready.")
                    )
                    .padding(.vertical, 80)
                } else {
                    LazyVStack(spacing: 0) {
                        ForEach(rows) { row in
                            rowView(row)
                                .padding(.top, row.startsGroup ? 10 : 2)
                        }
                        // While waiting on the agent: show a live preview of the
                        // answer it's writing if we could scrape clean prose,
                        // otherwise a slim sweeping bar. Both sit under the newest
                        // bubble and clear when the turn settles.
                        if isWaiting {
                            if let preview = model.livePreview {
                                LivePreviewBubble(text: preview)
                                    .padding(.top, 10)
                                    .transition(.opacity)
                            } else {
                                WaitingBar()
                                    .padding(.horizontal, 44)
                                    .padding(.top, 16)
                                    .padding(.bottom, 4)
                                    .transition(.opacity)
                            }
                        }
                        // Bottom sentinel: its visibility (LazyVStack only renders
                        // near-viewport items) tells us whether the reader is at the
                        // bottom, which drives the jump-to-bottom button.
                        Color.clear
                            .frame(height: 1)
                            .id(bottomAnchor)
                            .onAppear { atBottom = true }
                            .onDisappear { atBottom = false }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                }
            }
            .animation(.easeInOut(duration: 0.2), value: isWaiting)
            .defaultScrollAnchor(.bottom)
            // Reliably open at the newest message: a long transcript loads in
            // phases (cache seed → recent bulk load → live tail), and the default
            // anchor doesn't always re-pin as content grows. Force the jump on the
            // first load, then keep pinned only while already at the bottom (never
            // yank a reader who scrolled up).
            .onChange(of: model.messages.count) { _, _ in
                // Always jump to your own just-sent message; for incoming messages,
                // only stay pinned if you're already at the bottom (don't yank a
                // reader who scrolled up); and force it once on first load.
                let sentByMe = visibleMessages.last?.role == .user
                if !didInitialScroll || sentByMe || atBottom {
                    proxy.scrollTo(bottomAnchor, anchor: .bottom)
                    if !rows.isEmpty { didInitialScroll = true }
                }
            }
            .onAppear {
                guard !rows.isEmpty else { return }
                didInitialScroll = true
                DispatchQueue.main.async {
                    proxy.scrollTo(bottomAnchor, anchor: .bottom)
                }
            }
            #if os(iOS)
            .scrollDismissesKeyboard(.immediately)
            #endif
            .overlay(alignment: .bottomTrailing) {
                if !atBottom {
                    jumpToBottomButton(proxy)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .animation(.easeInOut(duration: 0.2), value: atBottom)
        }
    }

    /// WhatsApp-style floating "scroll to newest" affordance, shown only when the
    /// reader has scrolled up away from the bottom.
    private func jumpToBottomButton(_ proxy: ScrollViewProxy) -> some View {
        Button {
            withAnimation(.easeOut(duration: 0.25)) {
                proxy.scrollTo(bottomAnchor, anchor: .bottom)
            }
        } label: {
            Image(systemName: "chevron.down")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.tint)
                .frame(width: 38, height: 38)
                .background(.regularMaterial, in: Circle())
                .overlay(Circle().strokeBorder(Theme.separator.opacity(0.3), lineWidth: 0.5))
                .shadow(color: .black.opacity(0.12), radius: 4, y: 2)
        }
        .buttonStyle(PressableStyle())
        .padding(.trailing, 14)
        .padding(.bottom, 12)
        .accessibilityLabel("Jump to latest")
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
                        Label("Copy", systemImage: "doc.on.doc")
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
                Label("Failed to send — retry", systemImage: "exclamationmark.arrow.circlepath")
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
        // .center keeps the send button vertically centered against the field for
        // the common single-line case; the small min height stops a one-line pill
        // from collapsing tighter than the 34pt button.
        return HStack(alignment: .center, spacing: 6) {
            TextField("Message", text: $model.draft, axis: .vertical)
                .lineLimit(1...5)
                .padding(.leading, 16)
                .padding(.vertical, 8)
                .frame(minHeight: 36, alignment: .leading)
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
            .animation(.spring(response: 0.25, dampingFraction: 1), value: canSend)
            .sendHaptic(sendTrigger)
        }
        .composerGlass()
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

    /// The composer pill's surface. On iOS 26 this is real Liquid Glass — the
    /// system's own translucent, refracting material for floating controls (the
    /// "new glass design" the composer is meant to match). Applied AFTER layout
    /// so glass wraps the finished capsule. Older OSes keep the frosted
    /// `.regularMaterial` capsule with a hairline rim as the fallback.
    @ViewBuilder func composerGlass() -> some View {
        #if os(iOS)
        if #available(iOS 26, *) {
            self.glassEffect(.regular, in: Capsule(style: .continuous))
        } else {
            self.composerMaterialFallback()
        }
        #else
        self.composerMaterialFallback()
        #endif
    }

    func composerMaterialFallback() -> some View {
        self.background(
            ZStack {
                Capsule(style: .continuous).fill(.regularMaterial)
                Capsule(style: .continuous)
                    .strokeBorder(Theme.separator.opacity(0.35), lineWidth: 0.5)
            }
        )
    }
}
