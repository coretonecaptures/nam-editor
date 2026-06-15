import Foundation

struct BridgeSettings: Codable, Equatable {
    var host: String = ""
    var token: String = ""
    var refreshInterval: Double = 8
}

struct CompanionSnapshotResponse: Decodable {
    let ok: Bool
    let snapshot: CompanionSnapshot?
    let error: String?
}

struct CompanionHistoryResponse: Decodable {
    let ok: Bool
    let history: [CompanionHistoryEntry]?
    let error: String?
}

struct CompanionWatchersResponse: Decodable {
    let ok: Bool
    let watchers: [CompanionWatcher]?
    let error: String?
}

struct CompanionWatcherFilesResponse: Decodable {
    let ok: Bool
    let files: [CompanionWatcherFile]?
    let error: String?
}

struct CompanionPacksResponse: Decodable {
    let ok: Bool
    let packs: [CompanionPackSummary]?
    let error: String?
}

struct CompanionPackDetailResponse: Decodable {
    let ok: Bool
    let pack: CompanionPackDetail?
    let error: String?
}

struct CompanionInboxResponse: Decodable {
    let ok: Bool
    let inbox: [CompanionInboxItem]?
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

struct CompanionWatcherFile: Decodable, Identifiable {
    let filePath: String
    let fileName: String
    let sizeBytes: Int
    let mtimeMs: Double
    let statuses: [CompanionWatcherFileStatus]

    var id: String { filePath }
}

struct CompanionWatcherFileStatus: Decodable, Identifiable {
    let architecture: String
    let status: String

    var id: String { "\(architecture)-\(status)" }
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

struct CompanionPackDetail: Decodable, Identifiable {
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
    let description: String
    let about: String
    let capturedBy: String
    let checklistNotes: String
    let checklistItems: [CompanionChecklistItem]
}

struct CompanionChecklistItem: Decodable, Identifiable {
    let id: String
    let label: String
    let completed: Bool
    let completedDate: String
    let notes: String
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

enum CompanionConnectionState: Equatable {
    case disconnected
    case connecting
    case connected
    case failed(String)
}

extension CompanionSnapshot {
    static let empty = CompanionSnapshot(
        app: CompanionAppInfo(name: "NAM Lab", version: "", bridgePort: 38571, hostHints: [], rootFolder: "", activeFolder: ""),
        trainer: CompanionTrainerState(status: "idle", modelName: "", architecture: "", progressPercent: nil, progressEpochCurrent: nil, progressEpochTotal: nil, progressRate: nil, progressLatestLine: "", epochValidationEsr: nil, epochValidationEsrFull: nil, epochValidationEsrLite: nil, epochValidationEsrAggregate: nil, pauseAfterCurrent: false, activeJobId: nil, queue: []),
        history: [],
        watchers: [],
        library: CompanionLibrarySummary(rootFolder: "", activeFolder: "", packCount: 0, captureCount: 0, completedPackCount: 0, averageChecklistPercent: 0, upcomingPackCount: 0, livePackCount: 0),
        packs: [],
        inbox: [],
        tone3000: CompanionTone3000Status(connected: false, username: nil)
    )
}
