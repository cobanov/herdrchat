import SwiftUI

/// Manage saved herdr hosts. Selecting one opens its chats.
struct ConnectionListView: View {
    let store: ConnectionStore
    @Environment(\.dismiss) private var dismiss
    @State private var editing: ServerConnection?
    @State private var addingNew = false

    var body: some View {
        List {
            Section {
                ForEach(store.connections) { connection in
                    Button {
                        store.selectedID = connection.id
                        dismiss()
                    } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(connection.name).font(.headline)
                                Text("\(connection.username)@\(connection.host):\(connection.port)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if connection.id == store.selectedID {
                                Image(systemName: "checkmark").foregroundStyle(Theme.tint)
                            }
                        }
                    }
                    .swipeActions {
                        Button("Sil", role: .destructive) { store.delete(connection) }
                        Button("Düzenle") { editing = connection }.tint(.blue)
                    }
                }
            } header: {
                Text("herdr sunucuları")
            } footer: {
                Text("Tailscale adresi ve SSH ile bağlanır. Anahtar/parola Keychain'de saklanır.")
            }
        }
        .navigationTitle("Sunucular")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { addingNew = true } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $addingNew) {
            NavigationStack { ConnectionEditView(store: store, existing: nil) }
        }
        .sheet(item: $editing) { connection in
            NavigationStack { ConnectionEditView(store: store, existing: connection) }
        }
    }
}
