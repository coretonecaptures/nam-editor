import SwiftUI

@main
struct NamLabMobileApp: App {
    @StateObject private var store = CompanionStore()

    var body: some Scene {
        WindowGroup {
            CompanionRootView()
                .environmentObject(store)
        }
    }
}
