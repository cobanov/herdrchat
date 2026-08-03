import SwiftUI
import HerdrKit

/// The chat list: one row per workspace with live presence. Native furniture
/// throughout — large title, a visible server switcher in the top-left leading
/// slot (tap the server name to manage / add / switch devices), iMessage-style
/// leading attention dots, chevron-free rows. Rows read like Messages: title +
/// time on the first line, the last message (or live agent state) beneath.
struct ChatListView: View {
    let store: ConnectionStore
    let connection: ServerConnection

    @State private var model: WorkspacesViewModel
    @State private var showingConnections = false
    @State private var showingNewWorkspace = false
    @State private var path = NavigationPath()
    @Environment(\.scenePhase) private var scenePhase

    init(store: ConnectionStore, connection: ServerConnection) {
        self.store = store
        self.connection = connection
        _model = State(initialValue: WorkspacesViewModel(
            client: store.makeClient(for: connection),
            connectionID: connection.id.uuidString
        ))
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if let error = model.connectionError {
                    ConnectionErrorRow(
                        message: error,
                        canInstallHerdr: model.herdrMissing,
                        installing: model.isInstallingHerdr
                    ) {
                        Task { await model.installHerdr() }
                    }
                }
                ForEach(model.summaries) { summary in
                    ChatRow(summary: summary, connectionID: connection.id.uuidString)
                        .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 16))
                        .alignmentGuide(.listRowSeparatorLeading) { _ in 90 }
                }
                if model.summaries.isEmpty && model.connectionError == nil {
                    ContentUnavailableView(
                        model.isLoading ? "Connecting…" : "No workspaces",
                        systemImage: model.isLoading ? "antenna.radiowaves.left.and.right" : "tray",
                        description: model.isLoading
                            ? Text("Connecting to herdr on \(connection.name).")
                            : Text("Workspaces you open in herdr appear here.")
                    )
                    .listRowSeparator(.hidden)
                }
            }
            .listStyle(.plain)
            .navigationTitle("Chats")
            .toolbar {
                #if os(iOS)
                ToolbarItem(placement: .topBarLeading) { serverButton }
                ToolbarItem(placement: .topBarTrailing) { newWorkspaceButton }
                #else
                ToolbarItem { serverButton }
                ToolbarItem { newWorkspaceButton }
                #endif
            }
            .navigationDestination(for: ChatSummary.self) { summary in
                ChatThreadView(
                    client: store.makeClient(for: connection),
                    connectionID: connection.id.uuidString,
                    summary: summary
                )
            }
            .refreshable { await model.refresh() }
            .sheet(isPresented: $showingConnections) {
                NavigationStack { ConnectionListView(store: store) }
            }
            .sheet(isPresented: $showingNewWorkspace) {
                NewWorkspaceSheet(model: model) { summary in
                    path.append(summary)
                }
            }
        }
        .task { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: scenePhase) { _, phase in
            // Coming back to the app: re-sync now instead of waiting for the next
            // poll (and the transport reconnects on demand if the link died).
            if phase == .active { Task { await model.refresh() } }
        }
        #if DEBUG
        .task { await autoOpenIfRequested() }
        #endif
    }

    /// Server switcher + settings entry, always visible top-left. Shows which
    /// host you're on and opens device management (add / edit / switch).
    private var serverButton: some View {
        Button {
            showingConnections = true
        } label: {
            HStack(spacing: 3) {
                Image(systemName: "server.rack").imageScale(.small)
                Text(connection.name).fontWeight(.semibold)
                Image(systemName: "chevron.down").font(.caption2).opacity(0.5)
            }
            .font(.subheadline)
        }
        .accessibilityLabel("Server: \(connection.name). Manage servers.")
    }

    /// Start a fresh chat: create a workspace on the host and launch Claude in it.
    private var newWorkspaceButton: some View {
        Button {
            showingNewWorkspace = true
        } label: {
            Image(systemName: "square.and.pencil")
                .font(.system(size: 16, weight: .medium))
                .frame(width: 26, height: 26)
        }
        .accessibilityLabel("New chat")
    }

    #if DEBUG
    /// Dev/simulator hook: HERDRCHAT_AUTO_OPEN_WORKSPACE=<label|id> pushes that
    /// thread as soon as it appears, so headless test runs can screenshot the
    /// conversation screen without UI scripting.
    private func autoOpenIfRequested() async {
        guard let target = ProcessInfo.processInfo.environment["HERDRCHAT_AUTO_OPEN_WORKSPACE"] else { return }
        for _ in 0..<40 {   // up to ~10s for the first poll to land
            if let summary = model.summaries.first(where: { $0.title == target || $0.workspaceId == target }) {
                path.append(summary)
                return
            }
            try? await Task.sleep(for: .milliseconds(250))
        }
    }
    #endif
}

/// A single workspace row, Messages anatomy: leading dot à la Messages (orange =
/// waiting for you, emerald = unread result), presence-ring avatar, then
/// title + time and a two-line last-message preview. Live agent activity
/// overrides the preview line ("typing…" / "waiting for you"), WhatsApp-style.
private struct ChatRow: View {
    let summary: ChatSummary
    let connectionID: String

    private var isUnread: Bool {
        UnreadStore.shared.isUnread(UnreadStore.key(connectionID, summary.workspaceId))
    }

    var body: some View {
        ZStack {
            NavigationLink(value: summary) { EmptyView() }.opacity(0)
            HStack(spacing: 10) {
                leadingDot
                PresenceRingAvatar(
                    title: summary.title,
                    key: summary.title.isEmpty ? summary.workspaceId : summary.title,
                    status: summary.status
                )
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(summary.title)
                            .font(.headline)
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        if let time = formatListTime(summary.preview?.date) {
                            Text(time)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    subtitle
                }
            }
        }
    }

    private var leadingDot: some View {
        let color: Color? = summary.needsAttention ? Theme.attention : (isUnread ? Theme.tint : nil)
        return Circle()
            .fill(color ?? .clear)
            .frame(width: 9, height: 9)
    }

    /// Second line: live state wins (typing/blocked), last message otherwise.
    ///
    /// Every variant reserves the SAME height — two `subheadline` lines — because
    /// they swap live as agents start and stop working. The old code mixed a
    /// hardcoded 38pt for the live states with a two-line reservation for the
    /// preview, so a row visibly changed height (and nudged every row under it)
    /// each time an agent began typing. Reserving once, here, keeps the list still
    /// and survives Dynamic Type, which a magic number can't.
    @ViewBuilder
    private var subtitle: some View {
        ZStack(alignment: .topLeading) {
            Text(verbatim: " \n ")
                .font(.subheadline)
                .lineLimit(2, reservesSpace: true)
                .hidden()
                .accessibilityHidden(true)
            liveSubtitle
        }
    }

    @ViewBuilder
    private var liveSubtitle: some View {
        switch summary.status {
        case .working:
            HStack(spacing: 6) {
                // "working", not "typing": an agent isn't composing a message at a
                // keyboard, it's running tools and thinking. Borrowing the
                // messaging-app word oversold it and undersold what it does.
                Text("working…")
                    .font(.subheadline)
                    .foregroundStyle(Theme.tint)
                TypingDots(color: Theme.tint, size: 4.5)
            }
        case .blocked:
            Text("waiting for you")
                .font(.subheadline)
                .foregroundStyle(Theme.attention)
        default:
            Text(previewText)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
    }

    private var previewText: String {
        guard let preview = summary.preview else { return summary.subtitle }
        return preview.fromUser ? "You: \(preview.text)" : preview.text
    }
}

/// Messages-style row timestamp: time today, "Yesterday", weekday inside a week, date
/// beyond that.
func formatListTime(_ date: Date?) -> String? {
    guard let date else { return nil }
    let calendar = Calendar.current
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US")
    if calendar.isDateInToday(date) {
        formatter.dateFormat = "HH:mm"
    } else if calendar.isDateInYesterday(date) {
        return "Yesterday"
    } else if let days = calendar.dateComponents([.day], from: date, to: .now).day, days < 7 {
        formatter.dateFormat = "EEEE"
    } else {
        formatter.dateFormat = "M/d/yyyy"
    }
    return formatter.string(from: date)
}

/// Start a new conversation: create a workspace on the host at a chosen working
/// directory and launch Claude in it. Prefills the last-used directory and
/// offers the directories already in use as one-tap suggestions.
private struct NewWorkspaceSheet: View {
    let model: WorkspacesViewModel
    let onCreated: (ChatSummary) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var cwd = ""
    @State private var label = ""
    @State private var creating = false
    @State private var showingPicker = false
    /// Seeded from the connection's remembered choice in `onAppear`.
    @State private var permissionMode: PermissionMode = .bypass

    private var canStart: Bool {
        !cwd.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !creating
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("/Users/…/project", text: $cwd, axis: .vertical)
                        .autocorrectionDisabled()
                        .font(.callout.monospaced())
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                    Button {
                        showingPicker = true
                    } label: {
                        Label("Choose folder on device", systemImage: "folder")
                    }
                } header: {
                    Text("Working directory")
                } footer: {
                    Text("Claude starts in this directory. Type a path, or browse the device's folders to pick one.")
                }

                if !model.knownCwds.isEmpty {
                    Section("Recent") {
                        ForEach(model.knownCwds, id: \.self) { dir in
                            Button { cwd = dir } label: {
                                Label(dir, systemImage: "folder")
                                    .font(.callout)
                                    .lineLimit(1)
                                    .truncationMode(.head)
                            }
                            .foregroundStyle(.primary)
                        }
                    }
                }

                Section {
                    Picker("Permissions", selection: $permissionMode) {
                        ForEach(PermissionMode.allCases) { mode in
                            Label(mode.title, systemImage: mode.symbol).tag(mode)
                        }
                    }
                } header: {
                    Text("Permissions")
                } footer: {
                    Text(permissionMode.detail)
                }

                Section("Name (optional)") {
                    TextField("Automatic (folder name)", text: $label)
                        .autocorrectionDisabled()
                }
            }
            .navigationTitle("New chat")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                #if os(iOS)
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(creating)
                }
                ToolbarItem(placement: .confirmationAction) { startControl }
                #else
                ToolbarItem { startControl }
                #endif
            }
            .interactiveDismissDisabled(creating)
            .onAppear {
                if cwd.isEmpty { cwd = model.lastCwd }
                permissionMode = model.lastPermissionMode
            }
            .sheet(isPresented: $showingPicker) {
                DirectoryPickerView(model: model, start: cwd) { picked in
                    cwd = picked
                }
            }
        }
    }

    @ViewBuilder
    private var startControl: some View {
        if creating {
            ProgressView()
        } else {
            Button("Start") { start() }.disabled(!canStart)
        }
    }

    private func start() {
        creating = true
        Task {
            let summary = await model.createWorkspace(
                cwd: cwd,
                label: label.isEmpty ? nil : label,
                permissionMode: permissionMode
            )
            creating = false
            if let summary {
                dismiss()
                onCreated(summary)
            }
            // On failure the sheet stays open; the list row shows the error.
        }
    }
}

struct ConnectionErrorRow: View {
    let message: String
    var canInstallHerdr: Bool = false
    var installing: Bool = false
    var onInstall: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                VStack(alignment: .leading) {
                    Text("Connection error").font(.subheadline.weight(.semibold))
                    Text(message).font(.caption).foregroundStyle(.secondary).lineLimit(4)
                }
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.attention)
            }
            if canInstallHerdr, let onInstall {
                Button(action: onInstall) {
                    HStack(spacing: 6) {
                        if installing {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "arrow.down.circle")
                        }
                        Text(installing ? "Installing herdr…" : "Install herdr on the host")
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(installing)
                .padding(.leading, 28)
            }
        }
    }
}
