import SwiftUI

struct LibraryView: View {
    @EnvironmentObject private var store: CompanionStore

    var body: some View {
        NavigationStack {
            List {
                Section("Overview") {
                    LabeledContent("Root Folder", value: store.snapshot.library.rootFolder.isEmpty ? "Unavailable" : store.snapshot.library.rootFolder)
                    LabeledContent("Active Folder", value: store.snapshot.library.activeFolder.isEmpty ? "None" : store.snapshot.library.activeFolder)
                    LabeledContent("Captures", value: "\(store.snapshot.library.captureCount)")
                    LabeledContent("Packs", value: "\(store.snapshot.library.packCount)")
                    LabeledContent("Avg Checklist", value: "\(store.snapshot.library.averageChecklistPercent)%")
                }
            }
            .navigationTitle("Library")
        }
    }
}
