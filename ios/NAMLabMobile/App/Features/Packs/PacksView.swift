import SwiftUI

struct PacksView: View {
    @EnvironmentObject private var store: CompanionStore

    var body: some View {
        NavigationStack {
            List(store.snapshot.packs) { pack in
                VStack(alignment: .leading, spacing: 6) {
                    Text(pack.title)
                        .font(.headline)
                    Text(pack.subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    LinearProgressBar(value: Double(pack.checklistPercent), total: 100, tint: .green)
                    Text("\(pack.checklistCompletedCount) / \(pack.checklistTotalCount) checklist items • \(pack.captureCount) captures")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }
            .navigationTitle("Packs")
        }
    }
}
