import Foundation

actor PreviewCompanionBridgeClient: CompanionBridgeClientProtocol {
    private var snapshot = CompanionSnapshot.preview

    func fetchSnapshot(settings: BridgeSettings) async throws -> CompanionSnapshot {
        snapshot
    }

    func send(_ action: CompanionControlAction, settings: BridgeSettings) async throws -> CompanionActionFeedback {
        switch action {
        case .pauseAfterCurrent:
            snapshot = CompanionSnapshot(
                app: snapshot.app,
                trainer: CompanionTrainerState(
                    status: snapshot.trainer.status,
                    modelName: snapshot.trainer.modelName,
                    architecture: snapshot.trainer.architecture,
                    progressPercent: snapshot.trainer.progressPercent,
                    progressEpochCurrent: snapshot.trainer.progressEpochCurrent,
                    progressEpochTotal: snapshot.trainer.progressEpochTotal,
                    progressRate: snapshot.trainer.progressRate,
                    progressLatestLine: "Pause armed. Current run will finish before the queue stops.",
                    epochValidationEsr: snapshot.trainer.epochValidationEsr,
                    epochValidationEsrFull: snapshot.trainer.epochValidationEsrFull,
                    epochValidationEsrLite: snapshot.trainer.epochValidationEsrLite,
                    epochValidationEsrAggregate: snapshot.trainer.epochValidationEsrAggregate,
                    pauseAfterCurrent: true,
                    activeJobId: snapshot.trainer.activeJobId,
                    queue: snapshot.trainer.queue
                ),
                history: snapshot.history,
                watchers: snapshot.watchers,
                library: snapshot.library,
                packs: snapshot.packs,
                inbox: snapshot.inbox,
                tone3000: snapshot.tone3000
            )
            return CompanionActionFeedback(message: "Pause has been armed for the current run.")

        case .resumeQueue:
            snapshot = CompanionSnapshot.preview
            return CompanionActionFeedback(message: "Preview queue resumed.")

        case .emergencyStop:
            let failedHistory = CompanionHistoryEntry(
                historyId: "history-emergency",
                timestamp: "2026-07-01 14:30",
                profileName: snapshot.activeJob?.profileName,
                sourceMode: snapshot.activeJob?.sourceMode ?? "manual",
                sourcePath: snapshot.activeJob?.outputPath ?? "",
                architecture: snapshot.activeJob?.architecture ?? "",
                finalModelPath: "",
                status: "stopped",
                attempts: snapshot.activeJob?.attempts ?? 1,
                validationEsr: snapshot.activeJob?.validationEsr,
                validationEsrFull: nil,
                validationEsrLite: nil,
                epochs: snapshot.activeJob?.progressEpochCurrent ?? 0,
                finalModelName: snapshot.activeJob?.modelName ?? "Interrupted Run",
                failureReason: "Emergency stop issued from mobile companion.",
                submissionId: snapshot.activeJob?.submissionId,
                submissionLabel: snapshot.activeJob?.submissionLabel,
                durationSec: nil
            )
            snapshot = CompanionSnapshot(
                app: snapshot.app,
                trainer: CompanionTrainerState(
                    status: "idle",
                    modelName: "",
                    architecture: "",
                    progressPercent: nil,
                    progressEpochCurrent: nil,
                    progressEpochTotal: nil,
                    progressRate: nil,
                    progressLatestLine: "Emergency stop acknowledged by preview bridge.",
                    epochValidationEsr: nil,
                    epochValidationEsrFull: nil,
                    epochValidationEsrLite: nil,
                    epochValidationEsrAggregate: nil,
                    pauseAfterCurrent: false,
                    activeJobId: nil,
                    queue: snapshot.queuedJobs + snapshot.failedJobs
                ),
                history: [failedHistory] + snapshot.history,
                watchers: snapshot.watchers,
                library: snapshot.library,
                packs: snapshot.packs,
                inbox: snapshot.inbox,
                tone3000: snapshot.tone3000
            )
            return CompanionActionFeedback(message: "Emergency stop simulated in preview mode.")
        }
    }
}
