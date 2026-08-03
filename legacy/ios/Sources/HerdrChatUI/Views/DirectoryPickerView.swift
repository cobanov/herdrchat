import SwiftUI
import HerdrKit

/// Browse the host's filesystem to pick a working directory, instead of typing
/// an absolute path from memory. Starts at the home directory (or the path
/// already entered), drills into folders, walks back up, and returns the chosen
/// directory. Folder listing is one shell round-trip per level over the same
/// transport the rest of the app uses.
struct DirectoryPickerView: View {
    let model: WorkspacesViewModel
    /// Where to open: the path already typed, else "" to resolve $HOME.
    let start: String
    let onPick: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var path = ""
    @State private var entries: [String] = []
    @State private var loading = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(entries, id: \.self) { name in
                        Button {
                            navigate(to: child(name))
                        } label: {
                            HStack {
                                Label(name, systemImage: "folder.fill")
                                    .foregroundStyle(.primary)
                                    .lineLimit(1)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption)
                                    .foregroundStyle(.tertiary)
                            }
                        }
                    }
                    if entries.isEmpty && !loading {
                        Text("No subfolders")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text(path.isEmpty ? " " : path)
                        .font(.footnote.monospaced())
                        .textCase(nil)
                        .lineLimit(1)
                        .truncationMode(.head)
                }
            }
            .listStyle(.plain)
            .overlay { if loading { ProgressView() } }
            .navigationTitle("Choose folder")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                #if os(iOS)
                // Cancel leftmost; the up-a-directory control is its own separate
                // (round, glass on iOS 26) button right beside it — no overlap.
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarLeading) { upButton }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Select") { onPick(path); dismiss() }
                        .disabled(path.isEmpty || loading)
                }
                #else
                ToolbarItem { upButton }
                ToolbarItem {
                    Button("Select") { onPick(path); dismiss() }
                        .disabled(path.isEmpty || loading)
                }
                #endif
            }
            .task {
                let initial = start.trimmingCharacters(in: .whitespacesAndNewlines)
                navigate(to: initial.isEmpty ? await model.homeDirectory() : initial)
            }
        }
    }

    /// Icon-only "up a directory" control. In the iOS 26 toolbar this renders as
    /// its own round glass button, visually distinct from the Cancel text button.
    private var upButton: some View {
        Button {
            navigate(to: parent(of: path))
        } label: {
            Image(systemName: "chevron.up")
        }
        .disabled(path == "/" || path.isEmpty || loading)
        .accessibilityLabel("Parent folder")
    }

    private func navigate(to newPath: String) {
        loading = true
        path = newPath
        Task {
            let dirs = await model.listDirectories(at: newPath)
            entries = dirs
            loading = false
        }
    }

    private func child(_ name: String) -> String {
        path == "/" ? "/\(name)" : "\(path)/\(name)"
    }

    private func parent(of p: String) -> String {
        guard p != "/", let slash = p.lastIndex(of: "/") else { return "/" }
        let up = String(p[..<slash])
        return up.isEmpty ? "/" : up
    }
}
