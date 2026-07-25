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
    /// Is the viewport parked at the end of the list?
    @State private var atBottom = true
    /// Did the READER move the list themselves? Only their gesture counts —
    /// content growing must never be mistaken for "they scrolled up".
    @State private var readerTookOver = false
    private let bottomAnchor = "herdrchat.bottom"
    @Namespace private var glassNamespace

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
            if let error = model.error {
                errorRow(error)
            }
            bottomControls
        }
        .background(Theme.background)
        .animation(.spring(response: 0.35, dampingFraction: 0.9), value: model.isBlocked)
        .animation(.spring(response: 0.32, dampingFraction: 0.9), value: model.paneOverlay != nil)
        .animation(.easeOut(duration: 0.18), value: matchedCommands.isEmpty)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .principal) { header }
            #if os(iOS)
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    readerTookOver = false   // re-arm the auto-pin after reload
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
        case .working: "working"
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

    /// iOS 18+ reports real scroll geometry and phase, so "at the bottom" and
    /// "the reader moved it" can be measured instead of inferred. Older systems
    /// fall back to the bottom sentinel plus a drag gesture.
    private static var tracksScrollGeometry: Bool {
        if #available(iOS 18, macOS 15, *) { true } else { false }
    }

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
                        // A slash command leaves NO transcript turn (measured), so
                        // this receipt is the only trace in the conversation that
                        // it ran and what it did.
                        if let receipt = model.commandReceipt {
                            commandReceiptRow(receipt)
                                .padding(.top, 12)
                                .transition(.opacity)
                        }
                        // Bottom sentinel: always the `scrollTo` target. On systems
                        // without scroll geometry it also stands in for "at the
                        // bottom" via its lazy appearance — a coarse signal (a 1pt
                        // spacer realises before it is really visible), which is why
                        // iOS 18+ measures the geometry instead.
                        Color.clear
                            .frame(height: 1)
                            .id(bottomAnchor)
                            .onAppear { if !Self.tracksScrollGeometry { atBottom = true } }
                            .onDisappear { if !Self.tracksScrollGeometry { atBottom = false } }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                }
            }
            .animation(.easeInOut(duration: 0.2), value: isWaiting)
            .chatBottomAnchor()
            .chatScrollTracking(
                atBottom: { isAtEnd in
                    atBottom = isAtEnd
                    // Back at the end — hand control back to the auto-pin.
                    if isAtEnd { readerTookOver = false }
                },
                tookOver: { readerTookOver = true }
            )
            // Stay pinned to the newest message unless the READER scrolled away.
            // A long transcript arrives in phases (cache seed → recent window →
            // live tail); the previous version latched "we've scrolled once" on
            // the very first frame, so every phase that landed afterwards left
            // the list parked mid-history. Your own send always jumps.
            //
            // Runs on appear as well as on every change, and `id:` cancels the
            // previous attempt, so bursts coalesce instead of piling up.
            .task(id: model.messages.count) {
                let sentByMe = visibleMessages.last?.role == .user
                guard !readerTookOver || atBottom || sentByMe else { return }
                proxy.scrollTo(bottomAnchor, anchor: .bottom)
                // A bulk insert into a LazyVStack is measured lazily: the first
                // scrollTo resolves against ESTIMATED row heights and lands short
                // of the end, which is what left a long transcript sitting a
                // screenful above its newest message. Re-assert once the layout
                // pass has replaced the estimates with real heights.
                try? await Task.sleep(for: .milliseconds(50))
                guard !Task.isCancelled else { return }
                proxy.scrollTo(bottomAnchor, anchor: .bottom)
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

    /// A centred system-style note, the way Messages marks a non-message event.
    /// Tappable to dismiss, because it describes something that already happened.
    private func commandReceiptRow(_ text: String) -> some View {
        Button {
            model.clearCommandReceipt()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.caption2)
                Text(text)
                    .font(.caption)
                    .multilineTextAlignment(.center)
            }
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(Theme.fillSubtle, in: Capsule(style: .continuous))
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(text). Tap to dismiss.")
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
                .frame(width: 40, height: 40)
                .jumpButtonGlass()
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

    // MARK: - Bottom controls

    /// The floating control layer: quick replies for a blocked agent, then the
    /// composer. Both are Liquid Glass on iOS 26 and share ONE
    /// `GlassEffectContainer`, so the two shapes blend and morph into each other
    /// as the reply bar animates in rather than reading as two unrelated slabs.
    /// The container's spacing matches the stack's, which is what lets the shapes
    /// merge mid-transition.
    @ViewBuilder
    private var bottomControls: some View {
        if #available(iOS 26, macOS 26, *) {
            GlassEffectContainer(spacing: Self.controlSpacing) {
                VStack(spacing: Self.controlSpacing) {
                    palette
                        .glassEffectID("palette", in: glassNamespace)
                        .glassEffectTransition(.matchedGeometry)
                    replyBar
                        .glassEffectID("replyBar", in: glassNamespace)
                        .glassEffectTransition(.matchedGeometry)
                    composer
                        .glassEffectID("composer", in: glassNamespace)
                }
                .padding(.horizontal, 10)
                .padding(.top, 6)
                .padding(.bottom, 8)
            }
        } else {
            VStack(spacing: Self.controlSpacing) {
                palette
                replyBar
                composer
            }
            .padding(.horizontal, 10)
            .padding(.top, 6)
            .padding(.bottom, 8)
        }
    }

    // MARK: - Slash commands

    /// The `/`-token being typed, or nil when the draft isn't a command lookup.
    /// A space ends the lookup: past that point you're typing arguments, and the
    /// palette would only be in the way.
    private var commandQuery: String? {
        let draft = model.draft
        guard draft.hasPrefix("/") else { return nil }
        let token = draft.dropFirst()
        guard !token.contains(" "), !token.contains("\n") else { return nil }
        return String(token)
    }

    private var matchedCommands: [SlashCommand] {
        guard let query = commandQuery else { return [] }
        return model.commands
            .filter { $0.matches(query) }
            .sorted {
                let (a, b) = ($0.rank(for: query), $1.rank(for: query))
                return a == b ? $0.name < $1.name : a < b
            }
    }

    @ViewBuilder
    private var palette: some View {
        let matches = matchedCommands
        if !matches.isEmpty {
            SlashCommandPalette(commands: matches) { command in
                // Insert, don't send — the same contract as the terminal palette,
                // which leaves the command on the prompt so arguments can follow.
                model.draft = command.invocation + " "
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    /// One slot, two sources: a blocked agent's permission menu, or the picker a
    /// slash command just opened. They can't both be on screen (the view model
    /// suppresses the overlay while blocked), so they share the row.
    @ViewBuilder
    private var replyBar: some View {
        if model.isBlocked {
            BlockedReplyBar(prompt: model.blockedPrompt) { keys in
                Task { await model.sendKeys(keys) }
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        } else if let overlay = model.paneOverlay {
            BlockedReplyBar(
                prompt: overlay.prompt,
                actions: overlay.actions,
                isCommandMenu: true
            ) { keys in
                Task { await model.sendOverlayKeys(keys, overlay: overlay) }
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    private static let controlSpacing: CGFloat = 8

    // MARK: - Composer (floating glass capsule, iMessage-style)

    /// A single floating pill that hovers above the keyboard, with the send button
    /// inside on the trailing edge. No full-width bar behind it — the pill sits on
    /// the chat background with breathing room on every side, so there's no flat
    /// edge trying (and failing) to meet the keyboard's rounded top.
    private var composer: some View {
        let canSend = !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.isSending
        // `.bottom`, not `.center`: as the field grows the send button stays beside
        // the LAST line, the way Messages does it. Centred, it drifted into the
        // middle of a tall pill and looked unmoored from the text being sent.
        return HStack(alignment: .bottom, spacing: 6) {
            TextField("Message", text: $model.draft, axis: .vertical)
                .lineLimit(1...6)
                .padding(.leading, 16)
                .padding(.vertical, 8)
                .frame(minHeight: Self.composerLineHeight, alignment: .leading)
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
            .padding(.bottom, 3)
            .animation(.spring(response: 0.25, dampingFraction: 1), value: canSend)
            .sendHaptic(sendTrigger)
        }
        .composerGlass()   // outer padding comes from `bottomControls`
    }

    /// Height of the composer at one line. The pill's corner radius is half of
    /// this, which is the whole trick behind its shape: at one line the rounded
    /// rect IS a capsule, and as the field grows it stays a rounded rect with the
    /// same corners instead of inflating into a stadium — a real `Capsule` ties
    /// its radius to its height, which is why a long draft used to distort it.
    private static let composerLineHeight: CGFloat = 38

    private func copyToPasteboard(_ text: String) {
        #if canImport(UIKit)
        UIPasteboard.general.string = text
        #endif
    }
}

/// How close to the end still counts as "at the bottom" when measuring scroll
/// geometry — enough slack to survive a rubber-band and sub-pixel rounding.
private let bottomSlack: CGFloat = 28

private extension View {
    /// Keep the list's bottom edge stable. `.defaultScrollAnchor(.bottom)` on its
    /// own only decides the FIRST offset; the `.sizeChanges` role is what
    /// preserves the distance from the end as content grows — which is the entire
    /// behaviour a transcript wants: pinned while you're at the newest message,
    /// undisturbed while you're reading back through history. Without it, every
    /// bulk insert shifted the viewport and the pin had to be chased in code.
    @ViewBuilder
    func chatBottomAnchor() -> some View {
        if #available(iOS 18, macOS 15, *) {
            self
                .defaultScrollAnchor(.bottom)
                .defaultScrollAnchor(.bottom, for: .sizeChanges)
        } else {
            self.defaultScrollAnchor(.bottom)
        }
    }

    /// Feed the chat list its two scroll facts: whether the viewport sits at the
    /// end, and whether the READER moved it (as opposed to the content growing
    /// under them). iOS 18+ measures real geometry and scroll phase; older
    /// systems fall back to a drag gesture, with the bottom sentinel supplying
    /// `atBottom`.
    @ViewBuilder
    func chatScrollTracking(
        atBottom: @escaping (Bool) -> Void,
        tookOver: @escaping () -> Void
    ) -> some View {
        if #available(iOS 18, macOS 15, *) {
            self
                .onScrollGeometryChange(for: Bool.self) { geometry in
                    geometry.contentOffset.y + geometry.containerSize.height
                        >= geometry.contentSize.height - bottomSlack
                } action: { _, isAtEnd in
                    atBottom(isAtEnd)
                }
                .onScrollPhaseChange { _, phase in
                    // `.interacting` is the reader's finger only — programmatic
                    // scrolls report `.animating`, so the auto-pin can't
                    // mistake its own work for a reader taking over.
                    if phase == .interacting { tookOver() }
                }
        } else {
            self.simultaneousGesture(
                DragGesture(minimumDistance: 12).onChanged { _ in tookOver() }
            )
        }
    }

    /// The jump-to-bottom affordance's surface: a real floating control, so on
    /// iOS 26 it gets interactive Liquid Glass (it reacts to touch) instead of a
    /// hand-rolled material-plus-shadow imitation.
    @ViewBuilder
    func jumpButtonGlass() -> some View {
        #if os(iOS)
        if #available(iOS 26, *) {
            self.glassEffect(.regular.interactive(), in: Circle())
        } else {
            self.jumpButtonMaterialFallback()
        }
        #else
        self.jumpButtonMaterialFallback()
        #endif
    }

    func jumpButtonMaterialFallback() -> some View {
        self
            .background(.regularMaterial, in: Circle())
            .overlay(Circle().strokeBorder(Theme.separator.opacity(0.3), lineWidth: 0.5))
            .shadow(color: .black.opacity(0.12), radius: 4, y: 2)
    }

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
    /// so glass wraps the finished pill. Older OSes keep the frosted
    /// `.regularMaterial` pill with a hairline rim as the fallback.
    @ViewBuilder func composerGlass() -> some View {
        #if os(iOS)
        if #available(iOS 26, *) {
            self.glassEffect(.regular, in: composerShape)
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
                composerShape.fill(.regularMaterial)
                composerShape.strokeBorder(Theme.separator.opacity(0.35), lineWidth: 0.5)
            }
        )
    }
}

/// The composer's outline: a continuous rounded rect whose radius is half the
/// one-line height. At one line that is visually identical to a capsule; when the
/// draft wraps, the corners hold instead of stretching with the height the way a
/// `Capsule` does. Continuous (not circular) corners are what make it read as
/// system furniture rather than a hand-drawn pill.
private var composerShape: RoundedRectangle {
    RoundedRectangle(cornerRadius: 19, style: .continuous)
}

private extension View {
}
