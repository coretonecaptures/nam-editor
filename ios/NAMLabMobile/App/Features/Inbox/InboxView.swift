import SwiftUI

struct InboxView: View {
    @EnvironmentObject private var store: CompanionStore

    var body: some View {
        NavigationStack {
            List(store.snapshot.inbox) { item in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(item.title)
                            .font(.headline)
                        Spacer()
                        StatusPill(label: item.status.capitalized, tint: item.status == "new" ? .orange : .green)
                    }
                    Text(item.detail)
                        .font(.subheadline)
                    Text("\(item.kind.capitalized) • \(item.createdAt)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }
            .navigationTitle("Inbox")
        }
    }
}
