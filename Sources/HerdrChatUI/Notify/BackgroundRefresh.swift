import Foundation
import HerdrKit
import HerdrNet

#if os(iOS)
import BackgroundTasks

/// Server-free background notifications on iOS: a `BGAppRefreshTask` wakes the
/// app periodically (timing is at iOS's discretion, typically ≥15 min), opens a
/// fresh SSH connection, diffs agent statuses against the last-seen baseline,
/// and posts local notifications for blocked/done transitions. Note: a
/// force-quit (swipe-kill) suspends scheduling until the next manual launch —
/// an Apple platform rule, not something an app can override.
public enum BackgroundRefresh {
    public static let taskID = "dev.herdr.HerdrChat.refresh"

    /// Call once, before the app finishes launching.
    public static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskID, using: nil) { task in
            handle(task)
        }
    }

    private static func handle(_ task: BGTask) {
        schedule()   // keep the chain alive
        // BGTask isn't Sendable, but setTaskCompleted/expirationHandler are
        // documented thread-safe — safe to reference from the worker task.
        nonisolated(unsafe) let refresh = task
        let work = Task { @MainActor in
            await runOnce()
            refresh.setTaskCompleted(success: true)
        }
        task.expirationHandler = { work.cancel() }
    }

    /// (Re)arm the next refresh; call when the app enters the background.
    public static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: taskID)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    @MainActor
    private static func runOnce() async {
        let store = ConnectionStore()
        guard let connection = store.selected else { return }
        let client = store.makeClient(for: connection)
        defer {
            if let transport = client.transport as? SSHTransport {
                Task { await transport.disconnect() }
            }
        }
        guard let snapshot = try? await client.snapshot() else { return }
        let labels = (try? await client.workspaces())?
            .reduce(into: [String: String]()) { $0[$1.workspaceId] = $1.label } ?? [:]
        AgentNotifier.diffAndNotify(agents: snapshot.agents, workspaceLabels: labels)
    }
}
#else
/// No-op on platforms without BackgroundTasks (macOS builds of the package).
public enum BackgroundRefresh {
    public static func register() {}
    public static func schedule() {}
}
#endif
