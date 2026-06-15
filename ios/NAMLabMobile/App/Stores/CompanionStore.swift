import Foundation
import Combine

@MainActor
final class CompanionStore: ObservableObject {
    @Published var settings: BridgeSettings
    @Published var snapshot: CompanionSnapshot = .empty
    @Published var connectionState: CompanionConnectionState = .disconnected
    @Published var lastUpdatedAt: Date?
    @Published var watcherFilesByProfile: [String: [CompanionWatcherFile]] = [:]
    @Published var selectedPackDetail: CompanionPackDetail?
    @Published var selectedPackPath: String?
    @Published var transientMessage: String?

    private let settingsKey = "namlab.mobile.bridge.settings"
    private var refreshTask: Task<Void, Never>?

    init() {
        if let data = UserDefaults.standard.data(forKey: settingsKey),
           let decoded = try? JSONDecoder().decode(BridgeSettings.self, from: data) {
            self.settings = decoded
        } else {
            self.settings = BridgeSettings()
        }
        startAutoRefresh()
    }

    deinit {
        refreshTask?.cancel()
    }

    var canConnect: Bool {
        !settings.host.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !settings.token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var client: CompanionBridgeClient {
        CompanionBridgeClient(settings: settings)
    }

    func saveSettings(_ updated: BridgeSettings) {
        settings = updated
        if let data = try? JSONEncoder().encode(updated) {
            UserDefaults.standard.set(data, forKey: settingsKey)
        }
        startAutoRefresh()
    }

    func startAutoRefresh() {
        refreshTask?.cancel()
        guard canConnect else {
            connectionState = .disconnected
            return
        }
        refreshTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                await self.refresh()
                let seconds = max(3, min(self.settings.refreshInterval, 30))
                try? await Task.sleep(for: .seconds(seconds))
            }
        }
    }

    func refresh() async {
        guard canConnect else {
            connectionState = .disconnected
            return
        }
        connectionState = .connecting
        do {
            let liveSnapshot = try await client.fetchSnapshot()
            snapshot = liveSnapshot
            lastUpdatedAt = Date()
            connectionState = .connected
            if let selectedPackPath {
                selectedPackDetail = try? await client.fetchPackDetail(folderPath: selectedPackPath)
            }
        } catch {
            connectionState = .failed(error.localizedDescription)
        }
    }

    func refreshWatcherFiles(profileId: String) async {
        do {
            watcherFilesByProfile[profileId] = try await client.fetchWatcherFiles(profileId: profileId)
        } catch {
            transientMessage = error.localizedDescription
        }
    }

    func loadPackDetail(folderPath: String) async {
        do {
            selectedPackPath = folderPath
            selectedPackDetail = try await client.fetchPackDetail(folderPath: folderPath)
        } catch {
            transientMessage = error.localizedDescription
        }
    }

    func pauseAfterCurrent() async {
        await perform(message: "Queue will pause after the current run.") {
            try await self.client.pauseAfterCurrent()
        }
    }

    func resumeQueue() async {
        await perform(message: "Queue resumed.") {
            try await self.client.resumeQueue()
        }
    }

    func emergencyStop() async {
        await perform(message: "Emergency stop sent.") {
            try await self.client.emergencyStop()
        }
    }

    func retryHistory(_ entry: CompanionHistoryEntry) async {
        await perform(message: "Retry queued for \(entry.finalModelName).") {
            try await self.client.retryHistoryEntry(entry.historyId)
        }
    }

    func dismissBatch(submissionId: String) async {
        await perform(message: "Batch dismissed.") {
            try await self.client.dismissBatch(submissionId)
        }
    }

    func setWatcherRunning(profileId: String, running: Bool) async {
        await perform(message: running ? "Watcher started." : "Watcher stopped.") {
            try await self.client.setWatcherRunning(profileId: profileId, running: running)
        }
    }

    func toggleChecklistItem(_ item: CompanionChecklistItem, in pack: CompanionPackDetail) async {
        let completed = !item.completed
        let date = completed ? Self.isoDayString(from: Date()) : ""
        do {
            let updated = try await client.updateChecklistItem(folderPath: pack.folderPath, itemId: item.id, completed: completed, completedDate: date)
            selectedPackDetail = updated
            transientMessage = completed ? "Checklist updated." : "Checklist item reopened."
            await refresh()
        } catch {
            transientMessage = error.localizedDescription
        }
    }

    func createInboxItem(kind: String, title: String, detail: String, folderPath: String, imageData: Data? = nil) async {
        do {
            _ = try await client.createInboxItem(kind: kind, title: title, detail: detail, folderPath: folderPath, imageData: imageData)
            transientMessage = "Saved to companion inbox."
            await refresh()
        } catch {
            transientMessage = error.localizedDescription
        }
    }

    func markInboxReviewed(_ item: CompanionInboxItem) async {
        do {
            _ = try await client.markInboxReviewed(itemId: item.id)
            transientMessage = "Inbox item marked reviewed."
            await refresh()
        } catch {
            transientMessage = error.localizedDescription
        }
    }

    private func perform(message: String, operation: @escaping () async throws -> Void) async {
        do {
            try await operation()
            transientMessage = message
            await refresh()
        } catch {
            transientMessage = error.localizedDescription
        }
    }

    static func isoDayString(from date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .iso8601)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}
