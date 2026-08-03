import Foundation
import HerdrKit
import UserNotifications

/// In-app agent notifications — no push server of any kind. Local notifications
/// fire when an agent transitions into `blocked` (needs you) or `done`
/// (finished). The baseline (last seen status per pane) persists in
/// UserDefaults so the background-refresh task can diff against what the user
/// last saw.
@MainActor
public enum AgentNotifier {
    private static let defaultsKey = "herdrchat.agentStatuses"
    private static let notifiedKey = "herdrchat.agentNotifiedAt"
    /// Never re-announce the same pane in the same state inside this window. A
    /// backstop, not the primary defence: the baseline diff should already suppress
    /// repeats, but anything that perturbs it (a pane id recycled by herdr — ids
    /// compact when panes close — a snapshot that momentarily omits an agent, two
    /// hosts polling in turn) used to produce a stream of identical "finished"
    /// alerts. One alert per state change is the contract; this enforces it even
    /// when the diff is fooled.
    private static let repeatCooldown: TimeInterval = 30 * 60
    /// Forget panes not seen for a day so the stores can't grow without bound.
    private static let staleAfter: TimeInterval = 24 * 60 * 60

    /// Route foreground notifications to a delegate that presents them as banners.
    /// Without this, iOS silently drops local notifications while the app is
    /// active — so nothing shows when an agent finishes while you're in the app.
    public static func configureForegroundPresentation() {
        UNUserNotificationCenter.current().delegate = ForegroundNotificationPresenter.shared
    }

    public static func requestAuthorizationIfNeeded() {
        #if DEBUG
        // Headless test runs can't tap the system alert; let them opt out.
        if ProcessInfo.processInfo.environment["HERDRCHAT_SKIP_NOTIF_PROMPT"] != nil { return }
        #endif
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            guard settings.authorizationStatus == .notDetermined else { return }
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
        }
    }

    /// Update the baseline without notifying — called while the UI is visible,
    /// so the user isn't re-notified about states they're already looking at.
    public static func record(_ agents: [AgentInfo]) {
        save(statuses(of: agents))
    }

    /// Diff against the stored baseline and fire local notifications for
    /// blocked/done transitions. Used both by the background refresh task and by
    /// the live foreground polls; `excludingWorkspace` suppresses a notification
    /// for the thread you're currently looking at.
    public static func diffAndNotify(
        agents: [AgentInfo],
        workspaceLabels: [String: String],
        excludingWorkspace: String? = nil
    ) {
        let was = load()
        // MERGE, don't replace. `statuses(of:)` only describes the agents in THIS
        // snapshot, so overwriting dropped every pane missing from it — and each
        // connection polls its own host, so two servers wiped each other's baseline
        // on every tick and then re-announced every finished agent, forever.
        defer { save(was.merging(statuses(of: agents)) { _, new in new }) }
        guard !was.isEmpty else { return }   // first run: seed silently

        var notified = loadNotified()
        defer { saveNotified(notified) }
        let now = Date().timeIntervalSince1970

        for agent in agents {
            let status = agent.agentStatus
            guard status == .blocked || status == .done,
                  was[agent.paneId] != status.rawValue,
                  agent.workspaceId != excludingWorkspace else { continue }
            // Second gate: even if the diff thinks this is new, don't repeat an
            // identical alert for the same pane within the cooldown.
            let key = "\(agent.paneId)|\(status.rawValue)"
            if let last = notified[key], now - last < repeatCooldown { continue }
            notified[key] = now
            let workspace = workspaceLabels[agent.workspaceId] ?? agent.workspaceId
            let name = agent.agent ?? "agent"

            let content = UNMutableNotificationContent()
            if status == .blocked {
                content.title = "\(workspace) is waiting for you"
                content.body = "\(name) is waiting for a reply."
            } else {
                content.title = "\(workspace) is done"
                content.body = "\(name) finished its task."
            }
            content.sound = .default
            let request = UNNotificationRequest(
                identifier: "agent-\(agent.paneId)",
                content: content,
                trigger: nil
            )
            UNUserNotificationCenter.current().add(request)
        }
    }

    private static func statuses(of agents: [AgentInfo]) -> [String: String] {
        Dictionary(agents.map { ($0.paneId, $0.agentStatus.rawValue) }, uniquingKeysWith: { first, _ in first })
    }

    private static func load() -> [String: String] {
        UserDefaults.standard.dictionary(forKey: defaultsKey) as? [String: String] ?? [:]
    }

    private static func save(_ statuses: [String: String]) {
        UserDefaults.standard.set(statuses, forKey: defaultsKey)
    }

    /// When each (pane, status) pair was last announced.
    private static func loadNotified() -> [String: TimeInterval] {
        let stored = UserDefaults.standard.dictionary(forKey: notifiedKey) as? [String: Double] ?? [:]
        let cutoff = Date().timeIntervalSince1970 - staleAfter
        return stored.filter { $0.value >= cutoff }
    }

    private static func saveNotified(_ times: [String: TimeInterval]) {
        UserDefaults.standard.set(times, forKey: notifiedKey)
    }

    /// Clear the "already announced" memory — for a Notifications settings toggle or
    /// a manual reset, so a genuine re-announcement isn't blocked by the cooldown.
    public static func resetNotificationHistory() {
        UserDefaults.standard.removeObject(forKey: notifiedKey)
    }
}

/// Presents agent notifications as banners even when the app is in the foreground
/// (the default is to suppress them while active).
public final class ForegroundNotificationPresenter: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    public static let shared = ForegroundNotificationPresenter()

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }
}
