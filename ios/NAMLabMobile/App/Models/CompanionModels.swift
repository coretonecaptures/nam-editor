import Foundation
import SwiftUI

enum CompanionBridgeMode: String, Codable, CaseIterable, Identifiable {
    case preview
    case desktop

    var id: String { rawValue }

    var label: String {
        switch self {
        case .preview: return "Preview"
        case .desktop: return "Desktop Bridge"
        }
    }
}

enum AppAppearance: String, Codable, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

struct BridgeSettings: Codable, Equatable {
    var mode: CompanionBridgeMode = .preview
    var host: String = ""
    var token: String = ""
    var refreshInterval: Double = 8
}

struct CompanionSettings: Codable, Equatable {
    var bridge = BridgeSettings()
    var appearance: AppAppearance = .system
}

enum CompanionConnectionState: Equatable {
    case disconnected
    case connecting
    case connected
    case failed(String)

    var label: String {
        switch self {
        case .disconnected: return "Disconnected"
        case .connecting: return "Connecting"
        case .connected: return "Connected"
        case .failed: return "Failed"
        }
    }
}

enum CompanionLoadState: Equatable {
    case idle
    case loading
    case loaded
    case failed(String)
}

enum CompanionControlAction: String, Identifiable, CaseIterable {
    case pauseAfterCurrent
    case resumeQueue
    case emergencyStop

    var id: String { rawValue }

    var label: String {
        switch self {
        case .pauseAfterCurrent: return "Pause After Current"
        case .resumeQueue: return "Resume Queue"
        case .emergencyStop: return "Emergency Stop"
        }
    }

    var systemImage: String {
        switch self {
        case .pauseAfterCurrent: return "pause.circle"
        case .resumeQueue: return "play.circle"
        case .emergencyStop: return "stop.circle"
        }
    }
}

struct CompanionActionFeedback: Equatable {
    let message: String
}

struct CompanionSnapshotResponse: Decodable {
    let ok: Bool
    let snapshot: CompanionSnapshot?
    let error: String?
}

struct CompanionActionEnvelope<T: Decodable>: Decodable {
    let ok: Bool
    let data: T?
    let error: String?
}

struct CompanionEmptyActionData: Decodable {}

struct CompanionSnapshot: Decodable {
    let app: CompanionAppInfo
    let trainer: CompanionTrainerState
    let history: [CompanionHistoryEntry]
    let watchers: [CompanionWatcher]
    let library: CompanionLibrarySummary
    let packs: [CompanionPackSummary]
    let inbox: [CompanionInboxItem]
    let tone3000: CompanionTone3000Status
}

struct CompanionAppInfo: Decodable {
    let name: String
    let version: String
    let bridgePort: Int
    let hostHints: [String]
    let rootFolder: String
    let activeFolder: String
}

struct CompanionTone3000Status: Decodable {
    let connected: Bool
    let username: String?
}

struct CompanionTrainerState: Decodable {
    let status: String
    let modelName: String
    let architecture: String
    let progressPercent: Double?
    let progressEpochCurrent: Int?
    let progressEpochTotal: Int?
    let progressRate: Double?
    let progressLatestLine: String
    let epochValidationEsr: Double?
    let epochValidationEsrFull: Double?
    let epochValidationEsrLite: Double?
    let epochValidationEsrAggregate: Double?
    let pauseAfterCurrent: Bool
    let activeJobId: String?
    let queue: [CompanionQueueJob]
}

struct CompanionQueueJob: Decodable, Identifiable {
    let jobId: String
    let status: String
    let modelName: String
    let architecture: String
    let epochs: Int
    let attempts: Int
    let outputPath: String
    let sourceMode: String
    let profileName: String?
    let submissionId: String?
    let submissionLabel: String?
    let validationEsr: Double?
    let progressPercent: Double?
    let progressEpochCurrent: Int?
    let progressEpochTotal: Int?
    let error: String

    var id: String { jobId }
}

struct CompanionHistoryEntry: Decodable, Identifiable {
    let historyId: String
    let timestamp: String
    let profileName: String?
    let sourceMode: String
    let sourcePath: String
    let architecture: String
    let finalModelPath: String
    let status: String
    let attempts: Int
    let validationEsr: Double?
    let validationEsrFull: Double?
    let validationEsrLite: Double?
    let epochs: Int
    let finalModelName: String
    let failureReason: String
    let submissionId: String?
    let submissionLabel: String?
    let durationSec: Double?

    var id: String { historyId }
}

struct CompanionWatcher: Decodable, Identifiable {
    let profileId: String
    let profileName: String
    let enabled: Bool
    let autoRun: Bool
    let running: Bool
    let sourceMode: String
    let watchFolder: String
    let pendingCount: Int
    let skippedCount: Int

    var id: String { profileId }
}

struct CompanionLibrarySummary: Decodable {
    let rootFolder: String
    let activeFolder: String
    let packCount: Int
    let captureCount: Int
    let completedPackCount: Int
    let averageChecklistPercent: Int
    let upcomingPackCount: Int
    let livePackCount: Int
}

struct CompanionPackSummary: Decodable, Identifiable, Hashable {
    let id: String
    let folderPath: String
    let title: String
    let subtitle: String
    let checklistPercent: Int
    let checklistCompletedCount: Int
    let checklistTotalCount: Int
    let targetDate: String
    let liveDate: String
    let captureCount: Int
}

struct CompanionInboxItem: Decodable, Identifiable {
    let id: String
    let kind: String
    let title: String
    let detail: String
    let createdAt: String
    let folderPath: String
    let assetPath: String?
    let status: String
}

extension CompanionSnapshot {
    static let empty = CompanionSnapshot(
        app: CompanionAppInfo(name: "NAM Lab", version: "", bridgePort: 38571, hostHints: [], rootFolder: "", activeFolder: ""),
        trainer: CompanionTrainerState(
            status: "idle",
            modelName: "",
            architecture: "",
            progressPercent: nil,
            progressEpochCurrent: nil,
            progressEpochTotal: nil,
            progressRate: nil,
            progressLatestLine: "",
            epochValidationEsr: nil,
            epochValidationEsrFull: nil,
            epochValidationEsrLite: nil,
            epochValidationEsrAggregate: nil,
            pauseAfterCurrent: false,
            activeJobId: nil,
            queue: []
        ),
        history: [],
        watchers: [],
        library: CompanionLibrarySummary(rootFolder: "", activeFolder: "", packCount: 0, captureCount: 0, completedPackCount: 0, averageChecklistPercent: 0, upcomingPackCount: 0, livePackCount: 0),
        packs: [],
        inbox: [],
        tone3000: CompanionTone3000Status(connected: false, username: nil)
    )

    static let preview = CompanionSnapshot(
        app: CompanionAppInfo(
            name: "NAM Lab",
            version: "0.8.0-preview",
            bridgePort: 38571,
            hostHints: ["192.168.1.42", "namlab.local"],
            rootFolder: "/Users/admin/NAM Library",
            activeFolder: "Mesa Mark IV Pack"
        ),
        trainer: CompanionTrainerState(
            status: "running",
            modelName: "Mesa Mark IV CH3",
            architecture: "WaveNet",
            progressPercent: 63,
            progressEpochCurrent: 38,
            progressEpochTotal: 60,
            progressRate: 1.4,
            progressLatestLine: "Epoch 38 complete. Validation ESR trending down.",
            epochValidationEsr: 0.0064,
            epochValidationEsrFull: 0.0068,
            epochValidationEsrLite: 0.0061,
            epochValidationEsrAggregate: 0.0064,
            pauseAfterCurrent: false,
            activeJobId: "job-1",
            queue: [
                CompanionQueueJob(jobId: "job-1", status: "running", modelName: "Mesa Mark IV CH3", architecture: "WaveNet", epochs: 60, attempts: 1, outputPath: "/Models/Mesa-Mark-IV-CH3.nam", sourceMode: "watcher", profileName: "Main Queue", submissionId: "batch-17", submissionLabel: "Mesa Mark IV Batch", validationEsr: 0.0064, progressPercent: 63, progressEpochCurrent: 38, progressEpochTotal: 60, error: ""),
                CompanionQueueJob(jobId: "job-2", status: "queued", modelName: "Mesa Mark IV CH2", architecture: "WaveNet", epochs: 60, attempts: 0, outputPath: "/Models/Mesa-Mark-IV-CH2.nam", sourceMode: "watcher", profileName: "Main Queue", submissionId: "batch-17", submissionLabel: "Mesa Mark IV Batch", validationEsr: nil, progressPercent: nil, progressEpochCurrent: nil, progressEpochTotal: nil, error: ""),
                CompanionQueueJob(jobId: "job-3", status: "failed", modelName: "Rectifier Orange", architecture: "LSTM", epochs: 80, attempts: 2, outputPath: "/Models/Rectifier-Orange.nam", sourceMode: "manual", profileName: "After Hours", submissionId: "batch-16", submissionLabel: "Rectifier Recovery", validationEsr: nil, progressPercent: nil, progressEpochCurrent: nil, progressEpochTotal: nil, error: "Outlier spike during validation.")
            ]
        ),
        history: [
            CompanionHistoryEntry(historyId: "history-1", timestamp: "2026-07-01 13:15", profileName: "Main Queue", sourceMode: "watcher", sourcePath: "/Source/Mesa", architecture: "WaveNet", finalModelPath: "/Models/JCM800-Bright.nam", status: "completed", attempts: 1, validationEsr: 0.0058, validationEsrFull: 0.0061, validationEsrLite: 0.0055, epochs: 55, finalModelName: "JCM800 Bright", failureReason: "", submissionId: "batch-15", submissionLabel: "JCM800 Batch", durationSec: 4820),
            CompanionHistoryEntry(historyId: "history-2", timestamp: "2026-07-01 09:40", profileName: "After Hours", sourceMode: "manual", sourcePath: "/Source/Rectifier", architecture: "LSTM", finalModelPath: "", status: "failed", attempts: 2, validationEsr: nil, validationEsrFull: nil, validationEsrLite: nil, epochs: 23, finalModelName: "Rectifier Orange", failureReason: "Validation diverged after epoch 23.", submissionId: "batch-16", submissionLabel: "Rectifier Recovery", durationSec: 910)
        ],
        watchers: [
            CompanionWatcher(profileId: "watcher-1", profileName: "Main Queue", enabled: true, autoRun: true, running: true, sourceMode: "drop-folder", watchFolder: "/Users/admin/Captures/Incoming", pendingCount: 7, skippedCount: 1),
            CompanionWatcher(profileId: "watcher-2", profileName: "Bass Queue", enabled: true, autoRun: false, running: false, sourceMode: "drop-folder", watchFolder: "/Users/admin/Captures/Bass", pendingCount: 2, skippedCount: 0)
        ],
        library: CompanionLibrarySummary(rootFolder: "/Users/admin/NAM Library", activeFolder: "Mesa Mark IV Pack", packCount: 18, captureCount: 264, completedPackCount: 12, averageChecklistPercent: 74, upcomingPackCount: 3, livePackCount: 9),
        packs: [
            CompanionPackSummary(id: "pack-1", folderPath: "/Users/admin/NAM Library/Mesa", title: "Mesa Mark IV", subtitle: "Lead channel pack", checklistPercent: 88, checklistCompletedCount: 14, checklistTotalCount: 16, targetDate: "2026-07-04", liveDate: "", captureCount: 22),
            CompanionPackSummary(id: "pack-2", folderPath: "/Users/admin/NAM Library/JCM800", title: "JCM800 Bright", subtitle: "Classic crunch set", checklistPercent: 100, checklistCompletedCount: 12, checklistTotalCount: 12, targetDate: "2026-06-28", liveDate: "2026-06-29", captureCount: 15)
        ],
        inbox: [
            CompanionInboxItem(id: "inbox-1", kind: "note", title: "Mesa gain note", detail: "Take another low-input pass with bright off.", createdAt: "2026-07-01 14:03", folderPath: "/Users/admin/NAM Library/Mesa", assetPath: nil, status: "new"),
            CompanionInboxItem(id: "inbox-2", kind: "photo", title: "Front panel reference", detail: "Knob reference captured from amp room.", createdAt: "2026-07-01 11:10", folderPath: "/Users/admin/NAM Library/JCM800", assetPath: "front-panel.jpg", status: "reviewed")
        ],
        tone3000: CompanionTone3000Status(connected: true, username: "coretonecaptures")
    )
}

extension CompanionSnapshot {
    var activeJob: CompanionQueueJob? {
        trainer.queue.first(where: { $0.jobId == trainer.activeJobId }) ?? trainer.queue.first(where: { $0.status == "running" })
    }

    var queuedJobs: [CompanionQueueJob] {
        trainer.queue.filter { $0.status == "queued" }
    }

    var failedJobs: [CompanionQueueJob] {
        trainer.queue.filter { $0.status == "failed" }
    }

    var runningJobs: [CompanionQueueJob] {
        trainer.queue.filter { $0.status == "running" || $0.status == "starting" }
    }

    var activeWatcherCount: Int {
        watchers.filter(\.running).count
    }

    var inboxNewCount: Int {
        inbox.filter { $0.status == "new" }.count
    }
}
