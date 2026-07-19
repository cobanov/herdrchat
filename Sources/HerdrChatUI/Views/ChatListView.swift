import SwiftUI
import HerdrKit

/// The chat list: one row per workspace with live presence. Native furniture
/// throughout — large title, a visible server switcher in the top-left leading
/// slot (tap the server name to manage / add / switch devices), iMessage-style
/// leading attention dots, chevron-free rows.
struct ChatListView: View {
    let store: ConnectionStore
    let connection: ServerConnection

    @State private var model: WorkspacesViewModel
    @State private var showingConnections = false

    init(store: ConnectionStore, connection: ServerConnection) {
        self.store = store
        self.connection = connection
        _model = State(initialValue: WorkspacesViewModel(client: store.makeClient(for: connection)))
    }

    var body: some View {
        NavigationStack {
            List {
                if let error = model.connectionError {
                    ConnectionErrorRow(message: error)
                }
                ForEach(model.summaries) { summary in
                    ChatRow(summary: summary)
                        .listRowInsets(EdgeInsets(top: 7, leading: 12, bottom: 7, trailing: 16))
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
                #else
                ToolbarItem { serverButton }
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
        }
        .task { model.start() }
        .onDisappear { model.stop() }
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
}

/// A single workspace row: leading attention dot (iMessage's unread cue),
/// presence-ring avatar, title + live status line. No disclosure chevron.
private struct ChatRow: View {
    let summary: ChatSummary

    var body: some View {
        ZStack {
            NavigationLink(value: summary) { EmptyView() }.opacity(0)
            HStack(spacing: 10) {
                Circle()
                    .fill(Theme.attention)
                    .frame(width: 9, height: 9)
                    .opacity(summary.needsAttention ? 1 : 0)
                PresenceRingAvatar(
                    title: summary.title,
                    key: summary.title.isEmpty ? summary.workspaceId : summary.title,
                    status: summary.status
                )
                VStack(alignment: .leading, spacing: 2) {
                    Text(summary.title)
                        .font(.headline)
                        .lineLimit(1)
                    subtitle
                }
                Spacer(minLength: 0)
            }
        }
    }

    @ViewBuilder
    private var subtitle: some View {
        HStack(spacing: 6) {
            Text(summary.subtitle)
                .font(.subheadline)
                .foregroundStyle(summary.needsAttention ? Theme.attention : Color.secondary)
                .lineLimit(1)
            if summary.status == .working {
                TypingDots(color: Theme.tint, size: 4)
            }
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
