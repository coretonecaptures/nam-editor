import SwiftUI

struct DashboardView: View {
    @EnvironmentObject private var store: CompanionStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ConnectionBanner(state: store.connectionState, bridgeLabel: store.activeBridgeLabel, lastUpdatedAt: store.lastUpdatedAt)

                    HStack(spacing: 12) {
                        MetricCard(title: "Queued", value: "\(store.snapshot.queuedJobs.count)", note: "\(store.snapshot.runningJobs.count) active")
                        MetricCard(title: "Watchers", value: "\(store.snapshot.watchers.count)", note: "\(store.snapshot.activeWatcherCount) running")
                    }

                    HStack(spacing: 12) {
                        MetricCard(title: "Packs", value: "\(store.snapshot.library.packCount)", note: "\(store.snapshot.library.completedPackCount) complete")
                        MetricCard(title: "Inbox", value: "\(store.snapshot.inboxNewCount)", note: "new mobile items")
                    }

                    SectionCard(title: "Current Focus", subtitle: store.snapshot.app.activeFolder.isEmpty ? "No active folder" : store.snapshot.app.activeFolder) {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(store.snapshot.activeJob?.modelName ?? "No active run")
                                .font(.title3.weight(.semibold))
                            Text(store.snapshot.trainer.progressLatestLine.isEmpty ? "Waiting for the desktop bridge." : store.snapshot.trainer.progressLatestLine)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            LinearProgressBar(value: store.snapshot.trainer.progressPercent ?? 0, total: 100, tint: .blue)
                        }
                    }

                    SectionCard(title: "Library Health", subtitle: store.snapshot.library.rootFolder) {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Average checklist completion \(store.snapshot.library.averageChecklistPercent)%")
                                .font(.subheadline)
                            LinearProgressBar(value: Double(store.snapshot.library.averageChecklistPercent), total: 100, tint: .green)
                            Text("\(store.snapshot.library.captureCount) captures across \(store.snapshot.library.packCount) packs")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding()
            }
            .background(CompanionTheme.appBackground.ignoresSafeArea())
            .navigationTitle("Dashboard")
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
}
