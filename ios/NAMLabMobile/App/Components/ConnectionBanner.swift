import SwiftUI

struct ConnectionBanner: View {
    let state: CompanionConnectionState
    let bridgeLabel: String
    let lastUpdatedAt: Date?

    private var tint: Color {
        switch state {
        case .connected:
            return CompanionTheme.success
        case .connecting:
            return CompanionTheme.warning
        case .disconnected:
            return .secondary
        case .failed:
            return CompanionTheme.danger
        }
    }

    private var detail: String {
        switch state {
        case .failed(let message):
            return message
        default:
            if let lastUpdatedAt {
                return "Last refresh \(lastUpdatedAt.formatted(date: .omitted, time: .shortened))"
            }
            return "No refresh yet"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: state == .connected ? "desktopcomputer.and.iphone" : "antenna.radiowaves.left.and.right.slash")
                .foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 4) {
                Text("\(bridgeLabel) • \(state.label)")
                    .font(.subheadline.weight(.semibold))
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            StatusPill(label: state.label, tint: tint)
        }
        .padding(14)
        .background(CompanionTheme.panel, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(CompanionTheme.border, lineWidth: 1)
        )
    }
}
