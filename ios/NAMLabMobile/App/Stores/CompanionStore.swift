import Foundation
import Combine

@MainActor
final class CompanionStore: ObservableObject {
    @Published var settings: CompanionSettings
    @Published var snapshot: CompanionSnapshot = .empty
    @Published var connectionState: CompanionConnectionState = .disconnected
    @Published var loadState: CompanionLoadState = .idle
    @Published var lastUpdatedAt: Date?
    @Published var transientMessage: String?
    @Published var performingAction: CompanionControlAction?

    private let settingsKey = "namlab.mobile.companion.settings"
    private let previewBridge: any CompanionBridgeClientProtocol
    private let liveBridge: any CompanionBridgeClientProtocol
    private var refreshTask: Task<Void, Never>?

    init(
        previewBridge: any CompanionBridgeClientProtocol = PreviewCompanionBridgeClient(),
        liveBridge: any CompanionBridgeClientProtocol = LiveCompanionBridgeClient()
    ) {
        self.previewBridge = previewBridge
        self.liveBridge = liveBridge

        if let data = UserDefaults.standard.data(forKey: settingsKey),
           let decoded = try? JSONDecoder().decode(CompanionSettings.self, from: data) {
            settings = decoded
        } else {
            settings = CompanionSettings()
        }

        startAutoRefresh()
    }

    deinit {
        refreshTask?.cancel()
    }

    var activeBridgeLabel: String {
        settings.bridge.mode.label
    }

    func loadIfNeeded() async {
        guard case .idle = loadState else { return }
        await refresh()
    }

    func refresh() async {
        loadState = .loading
        connectionState = .connecting

        do {
            snapshot = try await bridge.fetchSnapshot(settings: settings.bridge)
            lastUpdatedAt = Date()
            loadState = .loaded
            connectionState = .connected
        } catch {
            let message = error.localizedDescription
            loadState = .failed(message)
            connectionState = .failed(message)
            transientMessage = message
        }
    }

    func perform(_ action: CompanionControlAction) async {
        performingAction = action
        defer { performingAction = nil }

        do {
            let feedback = try await bridge.send(action, settings: settings.bridge)
            transientMessage = feedback.message
            await refresh()
        } catch {
            let message = error.localizedDescription
            transientMessage = message
            loadState = .failed(message)
            connectionState = .failed(message)
        }
    }

    func updateAppearance(_ appearance: AppAppearance) {
        settings.appearance = appearance
        persistSettings()
    }

    func updateBridgeSettings(_ bridgeSettings: BridgeSettings) {
        settings.bridge = bridgeSettings
        persistSettings()
        startAutoRefresh()
    }

    private var bridge: any CompanionBridgeClientProtocol {
        settings.bridge.mode == .preview ? previewBridge : liveBridge
    }

    private func persistSettings() {
        if let data = try? JSONEncoder().encode(settings) {
            UserDefaults.standard.set(data, forKey: settingsKey)
        }
    }

    private func startAutoRefresh() {
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                await self.refresh()
                let seconds = max(5, min(self.settings.bridge.refreshInterval, 30))
                try? await Task.sleep(for: .seconds(seconds))
            }
        }
    }
}
