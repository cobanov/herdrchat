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
                    ConnectionErrorRow(message: error)
                }
                ForEach(model.summaries) { summary in
                    ChatRow(summary: summary, connectionID: connection.id.uuidString)
                        .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 16))
                        .alignmentGuide(.listRowSeparatorLeading) { _ in 90 }
                }
                if model.summaries.isEmpty && model.connectionError == nil {
                    ContentUnavailableView(
                        model.isLoading ? "Bağlanılıyor…" : "Workspace yok",
                        systemImage: model.isLoading ? "antenna.radiowaves.left.and.right" : "tray",
                        description: model.isLoading
                            ? Text("\(connection.name) üzerindeki herdr'a bağlanılıyor.")
                            : Text("herdr'da bir workspace açtığında burada görünür.")
                    )
                    .listRowSeparator(.hidden)
                }
            }
            .listStyle(.plain)
            .navigationTitle("Sohbetler")
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
        .accessibilityLabel("Sunucu: \(connection.name). Sunucuları yönet.")
    }

    /// Start a fresh chat: create a workspace on the host and launch Claude in it.
    private var newWorkspaceButton: some View {
        Button {
            showingNewWorkspace = true
        } label: {
            Image(systemName: "square.and.pencil")
        }
        .accessibilityLabel("Yeni sohbet")
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
/// overrides the preview line ("yazıyor…" / "seni bekliyor"), WhatsApp-style.
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
    @ViewBuilder
    private var subtitle: some View {
        switch summary.status {
        case .working:
            HStack(spacing: 6) {
                Text("yazıyor…")
                    .font(.subheadline)
                    .foregroundStyle(Theme.tint)
                TypingDots(color: Theme.tint, size: 4.5)
            }
            .frame(minHeight: 38, alignment: .top)
        case .blocked:
            Text("seni bekliyor")
                .font(.subheadline)
                .foregroundStyle(Theme.attention)
                .frame(minHeight: 38, alignment: .top)
        default:
            Text(previewText)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2, reservesSpace: true)
        }
    }

    private var previewText: String {
        guard let preview = summary.preview else { return summary.subtitle }
        return preview.fromUser ? "Sen: \(preview.text)" : preview.text
    }
}

/// Messages-style row timestamp: time today, "Dün", weekday inside a week, date
/// beyond that.
func formatListTime(_ date: Date?) -> String? {
    guard let date else { return nil }
    let calendar = Calendar.current
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "tr_TR")
    if calendar.isDateInToday(date) {
        formatter.dateFormat = "HH:mm"
    } else if calendar.isDateInYesterday(date) {
        return "Dün"
    } else if let days = calendar.dateComponents([.day], from: date, to: .now).day, days < 7 {
        formatter.dateFormat = "EEEE"
    } else {
        formatter.dateFormat = "d.MM.yyyy"
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

    private var canStart: Bool {
        !cwd.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !creating
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("/Users/…/proje", text: $cwd, axis: .vertical)
                        .autocorrectionDisabled()
                        .font(.callout.monospaced())
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                    Button {
                        showingPicker = true
                    } label: {
                        Label("Cihazda klasör seç", systemImage: "folder")
                    }
                } header: {
                    Text("Çalışma dizini")
                } footer: {
                    Text("Claude bu dizinde başlar. Yolu yazabilir ya da cihazdaki klasörlere göz atıp seçebilirsin.")
                }

                if !model.knownCwds.isEmpty {
                    Section("Son kullanılanlar") {
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

                Section("İsim (opsiyonel)") {
                    TextField("Otomatik (klasör adı)", text: $label)
                        .autocorrectionDisabled()
                }
            }
            .navigationTitle("Yeni sohbet")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                #if os(iOS)
                ToolbarItem(placement: .cancellationAction) {
                    Button("İptal") { dismiss() }.disabled(creating)
                }
                ToolbarItem(placement: .confirmationAction) { startControl }
                #else
                ToolbarItem { startControl }
                #endif
            }
            .interactiveDismissDisabled(creating)
            .onAppear { if cwd.isEmpty { cwd = model.lastCwd } }
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
            Button("Başlat") { start() }.disabled(!canStart)
        }
    }

    private func start() {
        creating = true
        Task {
            let summary = await model.createWorkspace(
                cwd: cwd,
                label: label.isEmpty ? nil : label
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
    var body: some View {
        Label {
            VStack(alignment: .leading) {
                Text("Bağlantı hatası").font(.subheadline.weight(.semibold))
                Text(message).font(.caption).foregroundStyle(.secondary).lineLimit(3)
            }
        } icon: {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.attention)
        }
    }
}
