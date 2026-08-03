import SwiftUI

/// App entry view. Shows the chat list for the selected herdr host, or the
/// connection setup screen if none is configured yet.
public struct RootView: View {
    @State private var store = ConnectionStore()

    public init() {}

    public var body: some View {
        Group {
            if let connection = store.selected {
                ChatListView(store: store, connection: connection)
                    .id(connection.id)   // rebuild the whole stack when switching host
            } else {
                NavigationStack {
                    ConnectionListView(store: store)
                }
            }
        }
        .tint(Theme.tint)
    }
}
