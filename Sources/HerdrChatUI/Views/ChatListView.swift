import SwiftUI
import HerdrKit

/// The chat list: one row per workspace, WhatsApp-style, with live presence.
struct ChatListView: View {
    let store: ConnectionStore
    let connection: ServerConnection

    @State private var model: WorkspacesViewModel
    @State private var showingConnections = false
    @Environment(\.colorScheme) private var scheme

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
                    NavigationLink(value: summary) {
                        ChatRow(summary: summary)
                    }
                }
                if model.summaries.isEmpty && model.connectionError == nil {
                    ContentUnavailableView(
                        model.isLoading ? "Bağlanılıyor…" : "Workspace yok",
                        systemImage: model.isLoading ? "antenna.radiowaves.left.and.right" : "tray"
                    )
                }
            }
            .listStyle(.plain)
            .navigationTitle(connection.name)
            .navigationDestination(for: ChatSummary.self) { summary in
                ChatThreadView(client: store.makeClient(for: connection), summary: summary)
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showingConnections = true } label: {
                        Image(systemName: "server.rack")
                    }
                }
            }
            .refreshable { await model.refresh() }
            .sheet(isPresented: $showingConnections) {
                NavigationStack { ConnectionListView(store: store) }
            }
        }
        .task {
            model.start()
        }
        .onDisappear { model.stop() }
    }
}

/// A single workspace row.
struct ChatRow: View {
    let summary: ChatSummary
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                Circle()
                    .fill(Theme.headerGreen.opacity(0.18))
                    .frame(width: 46, height: 46)
                    .overlay(
                        Text(initials)
                            .font(.headline)
                            .foregroundStyle(Theme.headerGreen)
                    )
                PresenceDot(status: summary.status)
                    .overlay(Circle().stroke(.background, lineWidth: 2))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(summary.title)
                    .font(.headline)
                    .foregroundStyle(Theme.primaryText(scheme))
                Text(summary.subtitle)
                    .font(.subheadline)
                    .foregroundStyle(summary.needsAttention ? Theme.statusColor(.blocked) : Theme.secondaryText(scheme))
                    .lineLimit(1)
            }
            Spacer()
            if summary.needsAttention {
                Circle()
                    .fill(Theme.statusColor(.blocked))
                    .frame(width: 10, height: 10)
            }
        }
        .padding(.vertical, 4)
    }

    private var initials: String {
        let letters = summary.title.split(separator: " ").compactMap(\.first).prefix(2)
        return letters.isEmpty ? "?" : String(letters).uppercased()
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
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
        }
    }
}
