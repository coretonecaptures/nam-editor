import SwiftUI

struct TrainingView: View {
    @EnvironmentObject private var store: CompanionStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ConnectionBanner(state: store.connectionState, bridgeLabel: store.activeBridgeLabel, lastUpdatedAt: store.lastUpdatedAt)
                    activeRunCard
                    queueSummaryCard
                    watcherSummaryCard
                    safeControlsCard
                    historySummaryCard
                }
                .padding()
            }
            .background(CompanionTheme.appBackground.ignoresSafeArea())
            .navigationTitle("Training")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await store.refresh() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
        }
    }

    private var activeRunCard: some View {
        SectionCard(
            title: "Active Run",
            subtitle: store.snapshot.activeJob?.profileName ?? store.snapshot.trainer.status.capitalized
        ) {
            if let activeJob = store.snapshot.activeJob {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(activeJob.modelName)
                                .font(.title3.weight(.semibold))
                            Text("\(activeJob.architecture) • Epoch \(activeJob.progressEpochCurrent ?? 0) / \(activeJob.progressEpochTotal ?? activeJob.epochs)")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        StatusPill(label: activeJob.status.capitalized, tint: .blue)
                    }
                    LinearProgressBar(value: activeJob.progressPercent ?? 0, total: 100, tint: .blue)
                    HStack(spacing: 12) {
                        MetricCard(title: "Progress", value: "\(Int(activeJob.progressPercent ?? 0))%", note: "current run")
                        MetricCard(title: "Validation ESR", value: formattedESR(store.snapshot.trainer.epochValidationEsr), note: "latest check")
                    }
                    Text(store.snapshot.trainer.progressLatestLine.isEmpty ? "No live trainer line yet." : store.snapshot.trainer.progressLatestLine)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("No run is currently active. The companion will show the live trainer state here once the desktop bridge is available.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var queueSummaryCard: some View {
        SectionCard(title: "Queue", subtitle: "Batches and jobs") {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    MetricCard(title: "Queued", value: "\(store.snapshot.queuedJobs.count)", note: "waiting jobs")
                    MetricCard(title: "Running", value: "\(store.snapshot.runningJobs.count)", note: "active now")
                    MetricCard(title: "Failed", value: "\(store.snapshot.failedJobs.count)", note: "need review")
                }

                ForEach(store.snapshot.trainer.queue.prefix(4)) { job in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(job.modelName)
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            StatusPill(label: job.status.capitalized, tint: color(for: job.status))
                        }
                        Text(job.submissionLabel ?? job.profileName ?? job.architecture)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        if let progress = job.progressPercent {
                            LinearProgressBar(value: progress, total: 100, tint: color(for: job.status))
                        }
                        if !job.error.isEmpty {
                            Text(job.error)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private var watcherSummaryCard: some View {
        SectionCard(title: "Watchers", subtitle: "Desktop intake sources") {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    MetricCard(title: "Profiles", value: "\(store.snapshot.watchers.count)", note: "\(store.snapshot.activeWatcherCount) running")
                    MetricCard(title: "Pending Files", value: "\(store.snapshot.watchers.reduce(0) { $0 + $1.pendingCount })", note: "across watchers")
                }

                ForEach(store.snapshot.watchers.prefix(3)) { watcher in
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(watcher.profileName)
                                .font(.subheadline.weight(.semibold))
                            Text(watcher.watchFolder)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 4) {
                            StatusPill(label: watcher.running ? "Running" : "Stopped", tint: watcher.running ? .green : .secondary)
                            Text("\(watcher.pendingCount) pending • \(watcher.skippedCount) skipped")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private var safeControlsCard: some View {
        SectionCard(title: "Safe Controls", subtitle: "No destructive queue surgery on mobile") {
            VStack(alignment: .leading, spacing: 12) {
                Text("These controls are intentionally narrow. They map to the future desktop bridge boundary and avoid direct filesystem or batch editing behavior.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                ForEach(CompanionControlAction.allCases) { action in
                    Button {
                        Task { await store.perform(action) }
                    } label: {
                        HStack {
                            Image(systemName: action.systemImage)
                            Text(action.label)
                            Spacer()
                            if store.performingAction == action {
                                ProgressView()
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(buttonTint(for: action))
                    .disabled(store.performingAction != nil)
                }
            }
        }
    }

    private var historySummaryCard: some View {
        SectionCard(title: "Recent History", subtitle: "Latest finished or failed runs") {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(store.snapshot.history.prefix(4)) { entry in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(entry.finalModelName)
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            StatusPill(label: entry.status.capitalized, tint: color(for: entry.status))
                        }
                        Text("\(entry.timestamp) • \(entry.architecture)")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        if !entry.failureReason.isEmpty {
                            Text(entry.failureReason)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        } else if let esr = entry.validationEsr {
                            Text("Validation ESR \(formattedESR(esr))")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private func color(for status: String) -> Color {
        switch status.lowercased() {
        case "running", "completed":
            return .green
        case "failed", "stopped":
            return .red
        case "queued", "starting":
            return .orange
        default:
            return .secondary
        }
    }

    private func buttonTint(for action: CompanionControlAction) -> Color {
        switch action {
        case .pauseAfterCurrent: return .orange
        case .resumeQueue: return .blue
        case .emergencyStop: return .red
        }
    }

    private func formattedESR(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.4f", value)
    }
}
