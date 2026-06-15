import PhotosUI
import SwiftUI

struct CompanionRootView: View {
    @StateObject private var store = CompanionStore()

    var body: some View {
        TabView {
            DashboardScreen(store: store)
                .tabItem { Label("Dashboard", systemImage: "gauge.with.dots.needle.50percent") }

            TrainingScreen(store: store)
                .tabItem { Label("Training", systemImage: "waveform.path.ecg") }

            LibraryScreen(store: store)
                .tabItem { Label("Library", systemImage: "square.grid.2x2") }

            InboxScreen(store: store)
                .tabItem { Label("Inbox", systemImage: "tray.full") }

            SettingsScreen(store: store)
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .tint(CompanionTheme.accent)
        .preferredColorScheme(.dark)
        .background(CompanionTheme.appBackground.ignoresSafeArea())
        .task {
            await store.refresh()
        }
        .overlay(alignment: .bottom) {
            if let message = store.transientMessage, !message.isEmpty {
                Text(message)
                    .font(.footnote.weight(.medium))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(CompanionTheme.raised, in: Capsule())
                    .overlay(
                        Capsule()
                            .stroke(CompanionTheme.border, lineWidth: 1)
                    )
                    .padding(.bottom, 20)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .onAppear {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                            if store.transientMessage == message {
                                store.transientMessage = nil
                            }
                        }
                    }
            }
        }
    }
}

private struct DashboardScreen: View {
    @ObservedObject var store: CompanionStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    healthHero
                    runningCard
                    metrics
                    libraryCard
                    packProgressCard
                    tone3000Card
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

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("NAM Lab Companion")
                .font(.title.bold())
            Text(connectionSubtitle)
                .foregroundStyle(.secondary)
        }
    }

    private var runningCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Now Running")
                        .font(.headline)
                    if let activeJob = store.snapshot.trainer.queue.first(where: { $0.jobId == store.snapshot.trainer.activeJobId }) {
                        Text(activeJob.modelName.isEmpty ? "Training in progress" : activeJob.modelName)
                            .font(.title3.weight(.semibold))
                        Text("\(displayArchitecture(activeJob.architecture)) • Epoch \(activeJob.progressEpochCurrent ?? 0) / \(activeJob.progressEpochTotal ?? activeJob.epochs)")
                            .foregroundStyle(.secondary)
                        DashboardLinearProgress(
                            value: activeJob.progressPercent ?? 0,
                            total: 100,
                            tint: .blue
                        )
                        HStack {
                            Label("ESR \(esrText)", systemImage: "chart.line.uptrend.xyaxis")
                            Spacer()
                            Label(rateText, systemImage: "clock")
                        }
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        DashboardMetricRow(items: [
                            ("Queued", "\(queuedCount)", .orange),
                            ("History", "\(store.snapshot.history.count)", .green),
                        ])
                    } else {
                        Text(store.snapshot.trainer.status == "idle" ? "Queue idle" : "Preparing next run")
                            .foregroundStyle(.secondary)
                        DashboardLinearProgress(
                            value: Double(queuedCount),
                            total: Double(max(queuedCount, 1)),
                            tint: .gray.opacity(0.45)
                        )
                        Text(store.snapshot.trainer.pauseAfterCurrent ? "Queue will pause after the current run." : "Waiting for the next action from desktop.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
                DashboardGauge(
                    value: store.snapshot.trainer.progressPercent ?? (store.snapshot.trainer.status == "idle" ? 0 : 8),
                    title: "Run",
                    subtitle: store.snapshot.trainer.status.capitalized,
                    tint: store.snapshot.trainer.status == "idle" ? .gray : .blue,
                    lineWidth: 10
                )
            }
        }
        .padding()
        .background(CompanionTheme.panel, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(CompanionTheme.border, lineWidth: 1)
        )
    }

    private var metrics: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                MetricCard(title: "Queued", value: "\(queuedCount)", note: "\(runningCount) active / starting")
                MetricCard(title: "Watchers", value: "\(store.snapshot.watchers.count)", note: "\(runningWatcherCount) running")
            }
            HStack(spacing: 12) {
                MetricCard(title: "Packs", value: "\(store.snapshot.library.packCount)", note: "\(store.snapshot.library.completedPackCount) complete")
                MetricCard(title: "Inbox", value: "\(store.snapshot.inbox.filter { $0.status == "new" }.count)", note: "\(reviewedInboxCount) reviewed")
            }
        }
    }

    private var libraryCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Library")
                    .font(.headline)
                Spacer()
                Text("\(libraryHealthScore)% health")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(healthColor)
            }
            Text(store.snapshot.library.rootFolder.isEmpty ? "No desktop library is open right now." : store.snapshot.library.rootFolder)
                .font(.footnote)
                .foregroundStyle(.secondary)
            DashboardLinearProgress(
                value: Double(store.snapshot.library.averageChecklistPercent),
                total: 100,
                tint: healthColor
            )
            DashboardMetricRow(items: [
                ("Captures", "\(store.snapshot.library.captureCount)", .blue),
                ("Avg Checklist", "\(store.snapshot.library.averageChecklistPercent)%", healthColor),
                ("Upcoming", "\(store.snapshot.library.upcomingPackCount)", .orange),
                ("Live", "\(store.snapshot.library.livePackCount)", .green),
            ])
        }
        .padding()
        .background(CompanionTheme.panelAlt, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(CompanionTheme.borderSoft, lineWidth: 1)
        )
    }

    private var packProgressCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Pack Progress")
                .font(.headline)
            if store.snapshot.library.packCount == 0 {
                Text("No pack folders are being tracked yet.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                DashboardProgressRow(
                    title: "Checklist Complete",
                    value: Double(store.snapshot.library.completedPackCount),
                    total: Double(max(store.snapshot.library.packCount, 1)),
                    tint: .green,
                    summary: "\(store.snapshot.library.completedPackCount) of \(store.snapshot.library.packCount) packs"
                )
                DashboardProgressRow(
                    title: "Released",
                    value: Double(store.snapshot.library.livePackCount),
                    total: Double(max(store.snapshot.library.packCount, 1)),
                    tint: .blue,
                    summary: "\(store.snapshot.library.livePackCount) live now"
                )
                DashboardProgressRow(
                    title: "Scheduled",
                    value: Double(store.snapshot.library.upcomingPackCount),
                    total: Double(max(store.snapshot.library.packCount, 1)),
                    tint: .orange,
                    summary: "\(store.snapshot.library.upcomingPackCount) with target dates"
                )
            }
        }
        .padding()
        .background(CompanionTheme.panelAlt, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(CompanionTheme.borderSoft, lineWidth: 1)
        )
    }

    private var tone3000Card: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Tone3000")
                .font(.headline)
            if store.snapshot.tone3000.connected {
                Text(store.snapshot.tone3000.username.map { "Connected as \($0)" } ?? "Connected")
                    .foregroundStyle(.secondary)
            } else {
                Text("Not connected on the desktop app")
                    .foregroundStyle(.secondary)
            }
            DashboardLinearProgress(
                value: store.snapshot.tone3000.connected ? 100 : 0,
                total: 100,
                tint: store.snapshot.tone3000.connected ? .purple : .gray.opacity(0.45)
            )
        }
        .padding()
        .background(CompanionTheme.panelAlt, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(CompanionTheme.borderSoft, lineWidth: 1)
        )
    }

    private var healthHero: some View {
        HStack(alignment: .center, spacing: 16) {
            DashboardGauge(
                value: Double(libraryHealthScore),
                title: "Health",
                subtitle: healthLabel,
                tint: healthColor,
                lineWidth: 12
            )
            VStack(alignment: .leading, spacing: 10) {
                Text("Desktop Readiness")
                    .font(.headline)
                Text(healthSummary)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                DashboardProgressRow(
                    title: "Inbox Reviewed",
                    value: Double(reviewedInboxCount),
                    total: Double(max(store.snapshot.inbox.count, 1)),
                    tint: .teal,
                    summary: "\(reviewedInboxCount) of \(store.snapshot.inbox.count) items"
                )
            }
        }
        .padding()
        .background(
            LinearGradient(
                colors: [
                    healthColor.opacity(0.18),
                    CompanionTheme.panelAlt
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 24, style: .continuous)
        )
    }

    private var connectionSubtitle: String {
        switch store.connectionState {
        case .disconnected:
            return "Add the desktop host and bridge token in Settings."
        case .connecting:
            return "Connecting to the desktop bridge..."
        case .connected:
            if let updated = store.lastUpdatedAt {
                return "Connected • Updated \(relativeDate(updated))"
            }
            return "Connected"
        case .failed(let message):
            return "Connection failed: \(message)"
        }
    }

    private var queuedCount: Int {
        store.snapshot.trainer.queue.filter { ["queued", "starting", "running"].contains($0.status) }.count
    }

    private var runningCount: Int {
        store.snapshot.trainer.queue.filter { ["running", "starting"].contains($0.status) }.count
    }

    private var runningWatcherCount: Int {
        store.snapshot.watchers.filter(\.running).count
    }

    private var reviewedInboxCount: Int {
        store.snapshot.inbox.filter { $0.status == "reviewed" }.count
    }

    private var completionRatio: Double {
        guard store.snapshot.library.packCount > 0 else { return 0 }
        return Double(store.snapshot.library.completedPackCount) / Double(store.snapshot.library.packCount)
    }

    private var releaseRatio: Double {
        guard store.snapshot.library.packCount > 0 else { return 0 }
        return Double(store.snapshot.library.livePackCount) / Double(store.snapshot.library.packCount)
    }

    private var watcherRatio: Double {
        guard !store.snapshot.watchers.isEmpty else { return 0 }
        return Double(runningWatcherCount) / Double(store.snapshot.watchers.count)
    }

    private var libraryHealthScore: Int {
        let checklistScore = Double(store.snapshot.library.averageChecklistPercent) * 0.5
        let completionScore = completionRatio * 30
        let watcherScore = watcherRatio * 10
        let inboxPenalty = min(Double(store.snapshot.inbox.filter { $0.status != "reviewed" }.count) * 2, 10)
        return max(0, min(100, Int((checklistScore + completionScore + watcherScore - inboxPenalty).rounded())))
    }

    private var healthColor: Color {
        switch libraryHealthScore {
        case 85...: return .green
        case 70...: return .teal
        case 50...: return .orange
        default: return .red
        }
    }

    private var healthLabel: String {
        switch libraryHealthScore {
        case 85...: return "Healthy"
        case 70...: return "Strong"
        case 50...: return "Needs Work"
        default: return "At Risk"
        }
    }

    private var healthSummary: String {
        if store.snapshot.library.packCount == 0 {
            return "Open a desktop library to start syncing release progress, captures, and inbox review."
        }
        return "\(store.snapshot.library.captureCount) captures across \(store.snapshot.library.packCount) packs with \(store.snapshot.library.averageChecklistPercent)% average checklist completion."
    }

    private var esrText: String {
        if let full = store.snapshot.trainer.epochValidationEsrFull {
            return formatDecimal(full)
        }
        if let esr = store.snapshot.trainer.epochValidationEsr {
            return formatDecimal(esr)
        }
        return "—"
    }

    private var rateText: String {
        if let rate = store.snapshot.trainer.progressRate {
            return String(format: "%.1f it/s", rate)
        }
        return "Waiting"
    }
}

private struct TrainingScreen: View {
    @ObservedObject var store: CompanionStore

    var body: some View {
        NavigationStack {
            List {
                Section("Controls") {
                    Button("Pause After Current") {
                        Task { await store.pauseAfterCurrent() }
                    }
                    .disabled(store.snapshot.trainer.status == "idle")

                    Button("Resume Queue") {
                        Task { await store.resumeQueue() }
                    }

                    Button("Emergency Stop", role: .destructive) {
                        Task { await store.emergencyStop() }
                    }
                    .disabled(store.snapshot.trainer.status == "idle")
                }

                Section("Queue") {
                    if store.snapshot.trainer.queue.isEmpty {
                        Text("No queue items right now.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(store.snapshot.trainer.queue) { job in
                            QueueJobRow(job: job, isActive: job.jobId == store.snapshot.trainer.activeJobId) {
                                guard let submissionId = job.submissionId else { return }
                                Task { await store.dismissBatch(submissionId: submissionId) }
                            }
                        }
                    }
                }

                Section("Recent History") {
                    ForEach(store.snapshot.history.prefix(12)) { entry in
                        HistoryRow(entry: entry) {
                            Task { await store.retryHistory(entry) }
                        }
                    }
                }

                Section("Watchers") {
                    ForEach(store.snapshot.watchers) { watcher in
                        NavigationLink {
                            WatcherDetailScreen(store: store, watcher: watcher)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(watcher.profileName)
                                    Text("\(watcher.running ? "Running" : "Stopped") • \(watcher.pendingCount) pending • \(watcher.skippedCount) skipped")
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Toggle("", isOn: Binding(
                                    get: { watcher.running },
                                    set: { newValue in
                                        Task { await store.setWatcherRunning(profileId: watcher.profileId, running: newValue) }
                                    }
                                ))
                                .labelsHidden()
                            }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(CompanionTheme.appBackground)
            .navigationTitle("Training")
        }
    }
}

private struct WatcherDetailScreen: View {
    @ObservedObject var store: CompanionStore
    let watcher: CompanionWatcher

    var files: [CompanionWatcherFile] {
        store.watcherFilesByProfile[watcher.profileId] ?? []
    }

    var body: some View {
        List {
            Section("Watcher") {
                Text(watcher.watchFolder)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("Files") {
                if files.isEmpty {
                    Text("No file status loaded yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(files) { file in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(file.fileName)
                                .font(.headline)
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack {
                                    ForEach(file.statuses) { status in
                                        Text("\(displayArchitecture(status.architecture)) • \(status.status)")
                                            .font(.caption)
                                            .padding(.horizontal, 10)
                                            .padding(.vertical, 6)
                                            .background(statusColor(status.status).opacity(0.14), in: Capsule())
                                            .foregroundStyle(statusColor(status.status))
                                    }
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(CompanionTheme.appBackground)
        .navigationTitle(watcher.profileName)
        .task {
            await store.refreshWatcherFiles(profileId: watcher.profileId)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await store.refreshWatcherFiles(profileId: watcher.profileId) }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
            }
        }
    }
}

private struct LibraryScreen: View {
    @ObservedObject var store: CompanionStore

    var body: some View {
        NavigationStack {
            List {
                Section("Overview") {
                    HStack(spacing: 12) {
                        MetricCard(title: "Packs", value: "\(store.snapshot.library.packCount)", note: "Release folders")
                        MetricCard(title: "Live", value: "\(store.snapshot.library.livePackCount)", note: "Already released")
                    }
                    HStack(spacing: 12) {
                        MetricCard(title: "Upcoming", value: "\(store.snapshot.library.upcomingPackCount)", note: "Target dates set")
                        MetricCard(title: "Done", value: "\(store.snapshot.library.completedPackCount)", note: "Checklist complete")
                    }
                }

                Section("Packs") {
                    ForEach(store.snapshot.packs) { pack in
                        NavigationLink {
                            PackDetailScreen(store: store, pack: pack)
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(pack.title)
                                    .font(.headline)
                                if !pack.subtitle.isEmpty {
                                    Text(pack.subtitle)
                                        .foregroundStyle(.secondary)
                                }
                                ProgressView(value: Double(pack.checklistPercent), total: 100)
                                Text("\(pack.captureCount) captures • \(pack.checklistPercent)% checklist")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(CompanionTheme.appBackground)
            .navigationTitle("Library")
        }
    }
}

private struct PackDetailScreen: View {
    @ObservedObject var store: CompanionStore
    let pack: CompanionPackSummary

    var detail: CompanionPackDetail? {
        store.selectedPackPath == pack.folderPath ? store.selectedPackDetail : nil
    }

    var body: some View {
        List {
            if let detail {
                Section("Summary") {
                    if !detail.subtitle.isEmpty { Text(detail.subtitle) }
                    if !detail.capturedBy.isEmpty {
                        LabeledContent("Captured By", value: detail.capturedBy)
                    }
                    LabeledContent("Captures", value: "\(detail.captureCount)")
                    if !detail.targetDate.isEmpty {
                        LabeledContent("Target Date", value: detail.targetDate)
                    }
                    if !detail.liveDate.isEmpty {
                        LabeledContent("Live Date", value: detail.liveDate)
                    }
                }

                if !detail.about.isEmpty || !detail.description.isEmpty {
                    Section("Notes") {
                        if !detail.about.isEmpty {
                            Text(detail.about)
                        }
                        if !detail.description.isEmpty {
                            Text(detail.description)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Section("Checklist") {
                    ForEach(detail.checklistItems) { item in
                        Button {
                            Task { await store.toggleChecklistItem(item, in: detail) }
                        } label: {
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: item.completed ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(item.completed ? .green : .secondary)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(item.label)
                                        .foregroundStyle(.primary)
                                    if !item.completedDate.isEmpty || !item.notes.isEmpty {
                                        Text([item.completedDate, item.notes].filter { !$0.isEmpty }.joined(separator: " • "))
                                            .font(.footnote)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                ProgressView("Loading pack...")
            }
        }
        .scrollContentBackground(.hidden)
        .background(CompanionTheme.appBackground)
        .navigationTitle(pack.title)
        .task {
            await store.loadPackDetail(folderPath: pack.folderPath)
        }
    }
}

private struct InboxScreen: View {
    @ObservedObject var store: CompanionStore
    @State private var title = ""
    @State private var detail = ""
    @State private var folderPath = ""
    @State private var kind = "note"
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var selectedPhotoData: Data?

    var body: some View {
        NavigationStack {
            List {
                Section("Add Item") {
                    Picker("Type", selection: $kind) {
                        Text("Note").tag("note")
                        Text("Photo").tag("photo")
                        Text("Cover").tag("cover")
                    }
                    TextField("Title", text: $title)
                    TextField("Notes", text: $detail, axis: .vertical)
                        .lineLimit(2...4)
                    TextField("Folder Path", text: $folderPath)
                    PhotosPicker(selection: $selectedPhoto, matching: .images) {
                        Label(selectedPhotoData == nil ? "Add Photo" : "Photo Ready", systemImage: "photo")
                    }
                    Button("Save To Inbox") {
                        Task {
                            await store.createInboxItem(kind: kind, title: title, detail: detail, folderPath: folderPath, imageData: selectedPhotoData)
                            title = ""
                            detail = ""
                            if kind == "note" { folderPath = "" }
                            selectedPhoto = nil
                            selectedPhotoData = nil
                        }
                    }
                }

                Section("Pending") {
                    let pending = store.snapshot.inbox.filter { $0.status != "reviewed" }
                    if pending.isEmpty {
                        Text("No pending inbox items.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(pending) { item in
                            InboxItemRow(item: item) {
                                Task { await store.markInboxReviewed(item) }
                            }
                        }
                    }
                }

                Section("Reviewed") {
                    ForEach(store.snapshot.inbox.filter { $0.status == "reviewed" }) { item in
                        InboxItemRow(item: item, actionTitle: nil, action: nil)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(CompanionTheme.appBackground)
            .navigationTitle("Inbox")
        }
        .onChange(of: selectedPhoto) { _, newValue in
            guard let newValue else { return }
            Task {
                selectedPhotoData = try? await newValue.loadTransferable(type: Data.self)
            }
        }
    }
}

private struct SettingsScreen: View {
    @ObservedObject var store: CompanionStore
    @State private var draft: BridgeSettings

    init(store: CompanionStore) {
        self.store = store
        _draft = State(initialValue: store.settings)
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Desktop Bridge") {
                    TextField("Host or IP", text: $draft.host)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Bridge Token", text: $draft.token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    HStack {
                        Text("Refresh")
                        Spacer()
                        Text("\(Int(draft.refreshInterval))s")
                            .foregroundStyle(.secondary)
                    }
                    Slider(value: $draft.refreshInterval, in: 3...30, step: 1)
                    Button("Save Connection") {
                        store.saveSettings(draft)
                        Task { await store.refresh() }
                    }
                }

                Section("Status") {
                    Text(statusText)
                        .foregroundStyle(.secondary)
                    if !store.snapshot.app.hostHints.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Desktop host hints")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            ForEach(store.snapshot.app.hostHints, id: \.self) { hint in
                                Text("\(hint):\(store.snapshot.app.bridgePort)")
                                    .font(.footnote.monospaced())
                            }
                        }
                    }
                    if !store.snapshot.app.rootFolder.isEmpty {
                        Text("Current desktop root: \(store.snapshot.app.rootFolder)")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(CompanionTheme.appBackground)
            .navigationTitle("Settings")
        }
        .onAppear {
            draft = store.settings
        }
    }

    private var statusText: String {
        switch store.connectionState {
        case .disconnected:
            return "Disconnected"
        case .connecting:
            return "Connecting..."
        case .connected:
            return "Connected to \(store.snapshot.app.name) \(store.snapshot.app.version)"
        case .failed(let message):
            return "Failed: \(message)"
        }
    }
}

private struct QueueJobRow: View {
    let job: CompanionQueueJob
    let isActive: Bool
    let dismissAction: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(job.modelName.isEmpty ? "Queued run" : job.modelName)
                    .font(.headline)
                Spacer()
                Text(job.status.capitalized)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(statusColor(job.status).opacity(0.14), in: Capsule())
                    .foregroundStyle(statusColor(job.status))
            }
            Text("\(displayArchitecture(job.architecture)) • \(job.profileName ?? job.sourceMode)")
                .font(.footnote)
                .foregroundStyle(.secondary)
            if let current = job.progressEpochCurrent {
                Text("Epoch \(current) / \(job.progressEpochTotal ?? job.epochs)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let submission = job.submissionLabel, let dismissAction {
                Button("Dismiss \(submission)") {
                    dismissAction()
                }
                .font(.footnote)
            }
            if !job.error.isEmpty {
                Text(job.error)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if isActive, let percent = job.progressPercent {
                ProgressView(value: percent, total: 100)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct DashboardGauge: View {
    let value: Double
    let title: String
    let subtitle: String
    let tint: Color
    let lineWidth: CGFloat

    private var clampedValue: Double {
        min(max(value, 0), 100)
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(tint.opacity(0.16), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: clampedValue / 100)
                .stroke(tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 2) {
                Text("\(Int(clampedValue.rounded()))")
                    .font(.title3.bold())
                Text(title.uppercased())
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.secondary)
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 8)
        }
        .frame(width: 112, height: 112)
    }
}

private struct DashboardLinearProgress: View {
    let value: Double
    let total: Double
    let tint: Color

    private var fraction: Double {
        guard total > 0 else { return 0 }
        return min(max(value / total, 0), 1)
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 999)
                    .fill(Color.secondary.opacity(0.14))
                RoundedRectangle(cornerRadius: 999)
                    .fill(tint)
                    .frame(width: max(CGFloat(6), proxy.size.width * CGFloat(fraction)))
            }
        }
        .frame(height: 10)
    }
}

private struct DashboardProgressRow: View {
    let title: String
    let value: Double
    let total: Double
    let tint: Color
    let summary: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(total > 0 ? "\(Int((min(max(value / total, 0), 1) * 100).rounded()))%" : "0%")
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            DashboardLinearProgress(value: value, total: total, tint: tint)
            Text(summary)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}

private struct DashboardMetricRow: View {
    let items: [(String, String, Color)]

    var body: some View {
        HStack(spacing: 10) {
            ForEach(Array(items.enumerated()), id: \.offset) { entry in
                let item = entry.element
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.0)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(item.1)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(item.2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(item.2.opacity(0.10), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
    }
}

private struct HistoryRow: View {
    let entry: CompanionHistoryEntry
    let retryAction: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(entry.finalModelName)
                    .font(.headline)
                Spacer()
                Text(entry.status.capitalized)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(statusColor(entry.status).opacity(0.14), in: Capsule())
                    .foregroundStyle(statusColor(entry.status))
            }
            Text("\(displayArchitecture(entry.architecture)) • \(entry.profileName ?? entry.sourceMode)")
                .font(.footnote)
                .foregroundStyle(.secondary)
            if let esr = entry.validationEsrFull ?? entry.validationEsr {
                Text("ESR \(formatDecimal(esr))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if entry.status == "error" || entry.status == "canceled" {
                Button("Retry") {
                    retryAction()
                }
                .font(.footnote)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct InboxItemRow: View {
    let item: CompanionInboxItem
    let actionTitle: String?
    let action: (() -> Void)?

    init(item: CompanionInboxItem, actionTitle: String? = "Mark Reviewed", action: (() -> Void)? = nil) {
        self.item = item
        self.actionTitle = actionTitle
        self.action = action
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(item.title)
                    .font(.headline)
                Spacer()
                Text(item.kind.uppercased())
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.secondary)
            }
            if !item.detail.isEmpty {
                Text(item.detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if !item.folderPath.isEmpty {
                Text(item.folderPath)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let actionTitle, let action {
                Button(actionTitle) { action() }
                    .font(.footnote)
            }
        }
        .padding(.vertical, 4)
    }
}

private func statusColor(_ status: String) -> Color {
    switch status {
    case "running", "starting", "queued":
        return .blue
    case "success", "done":
        return .green
    case "error", "failed":
        return .red
    case "canceled", "skipped":
        return .orange
    default:
        return .secondary
    }
}

private func displayArchitecture(_ value: String) -> String {
    value.uppercased()
}

private func formatDecimal(_ value: Double) -> String {
    String(format: "%.4f", value)
}

private func relativeDate(_ date: Date) -> String {
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .short
    return formatter.localizedString(for: date, relativeTo: Date())
}

enum CompanionTheme {
    static let accent = Color(red: 0.39, green: 0.40, blue: 0.95)
    static let appBackground = Color(hex: 0x1E1E1E)
    static let panel = Color(hex: 0x262626)
    static let panelAlt = Color(hex: 0x2A2A2A)
    static let raised = Color(hex: 0x2F2F2F)
    static let border = Color(hex: 0x383838)
    static let borderSoft = Color(hex: 0x2E2E2E)
}

private extension Color {
    init(hex: UInt32, alpha: Double = 1.0) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue: Double(hex & 0xFF) / 255.0,
            opacity: alpha
        )
    }
}

#Preview {
    CompanionRootView()
}
