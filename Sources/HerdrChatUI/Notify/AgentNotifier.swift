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
    /// blocked/done transitions (used by the background refresh task).
    public static func diffAndNotify(agents: [AgentInfo], workspaceLabels: [String: String]) {
        let was = load()
        defer { save(statuses(of: agents)) }
        guard !was.isEmpty else { return }   // first run: seed silently

        for agent in agents {
            let status = agent.agentStatus
            guard status == .blocked || status == .done,
                  was[agent.paneId] != status.rawValue else { continue }
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
}
