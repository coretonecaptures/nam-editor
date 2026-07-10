import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: CompanionStore
    @State private var bridgeSettings = BridgeSettings()

    var body: some View {
        NavigationStack {
            Form {
                Section("Appearance") {
                    Picker("Theme", selection: Binding(
                        get: { store.settings.appearance },
                        set: { store.updateAppearance($0) }
                    )) {
                        ForEach(AppAppearance.allCases) { appearance in
                            Text(appearance.label).tag(appearance)
                        }
                    }
                }

                Section("Bridge") {
                    Picker("Mode", selection: $bridgeSettings.mode) {
                        ForEach(CompanionBridgeMode.allCases) { mode in
                            Text(mode.label).tag(mode)
                        }
                    }

                    if bridgeSettings.mode == .desktop {
                        TextField("Desktop Host", text: $bridgeSettings.host)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        TextField("Bridge Token", text: $bridgeSettings.token)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }

                    HStack {
                        Text("Refresh Interval")
                        Spacer()
                        Text("\(Int(bridgeSettings.refreshInterval))s")
                            .foregroundStyle(.secondary)
                    }
                    Slider(value: $bridgeSettings.refreshInterval, in: 5...30, step: 1)

                    Button("Save Bridge Settings") {
                        store.updateBridgeSettings(bridgeSettings)
                    }
                }

                Section("Status") {
                    LabeledContent("Connection", value: store.connectionState.label)
                    LabeledContent("Bridge", value: store.activeBridgeLabel)
                    if let lastUpdatedAt = store.lastUpdatedAt {
                        LabeledContent("Last Refresh", value: lastUpdatedAt.formatted(date: .omitted, time: .shortened))
                    }
                }
            }
            .navigationTitle("Settings")
            .onAppear {
                bridgeSettings = store.settings.bridge
            }
        }
    }
}
