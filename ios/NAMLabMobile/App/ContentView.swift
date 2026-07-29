import SwiftUI

struct CompanionRootView: View {
    @EnvironmentObject private var store: CompanionStore

    var body: some View {
        TabView {
            DashboardView()
                .tabItem { Label("Dashboard", systemImage: "gauge.with.dots.needle.50percent") }

            TrainingView()
                .tabItem { Label("Training", systemImage: "waveform.path.ecg") }

            LibraryView()
                .tabItem { Label("Library", systemImage: "square.grid.2x2") }

            PacksView()
                .tabItem { Label("Packs", systemImage: "shippingbox") }

            InboxView()
                .tabItem { Label("Inbox", systemImage: "tray.full") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .tint(CompanionTheme.accent)
        .preferredColorScheme(store.settings.appearance.colorScheme)
        .task {
            await store.loadIfNeeded()
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
            }
        }
    }
}
