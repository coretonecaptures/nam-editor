import Foundation

enum CompanionBridgeError: LocalizedError {
    case missingHost
    case missingToken
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .missingHost:
            return "Enter the desktop host or IP address."
        case .missingToken:
            return "Enter the bridge token from the desktop app."
        case .invalidResponse:
            return "The desktop bridge returned an unexpected response."
        case .server(let message):
            return message
        }
    }
}

struct CompanionBridgeClient {
    let settings: BridgeSettings
    private let decoder = JSONDecoder()

    private var baseURL: URL? {
        guard !settings.host.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let raw = settings.host.trimmingCharacters(in: .whitespacesAndNewlines)
        let withScheme = raw.contains("://") ? raw : "http://\(raw)"
        guard var components = URLComponents(string: withScheme) else { return nil }
        if components.port == nil {
            components.port = 38571
        }
        return components.url
    }

    private func request(path: String, method: String = "GET", body: Data? = nil) throws -> URLRequest {
        guard let baseURL else { throw CompanionBridgeError.missingHost }
        guard !settings.token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw CompanionBridgeError.missingToken }
        let url = baseURL.appending(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("Bearer \(settings.token.trimmingCharacters(in: .whitespacesAndNewlines))", forHTTPHeaderField: "Authorization")
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        return request
    }

    private func fetch<T: Decodable>(_ type: T.Type, path: String) async throws -> T {
        let request = try request(path: path)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            throw CompanionBridgeError.invalidResponse
        }
        return try decoder.decode(T.self, from: data)
    }

    private func post<T: Decodable>(_ type: T.Type, path: String, payload: some Encodable) async throws -> T {
        let body = try JSONEncoder().encode(AnyEncodable(payload))
        let request = try request(path: path, method: "POST", body: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw CompanionBridgeError.invalidResponse
        }
        let decoded = try decoder.decode(T.self, from: data)
        guard 200..<300 ~= http.statusCode else {
            if let envelope = decoded as? CompanionActionEnvelope<CompanionEmptyActionData>, let error = envelope.error {
                throw CompanionBridgeError.server(error)
            }
            throw CompanionBridgeError.invalidResponse
        }
        return decoded
    }

    func fetchSnapshot() async throws -> CompanionSnapshot {
        let response = try await fetch(CompanionSnapshotResponse.self, path: "/api/v1/snapshot")
        guard response.ok, let snapshot = response.snapshot else {
            throw CompanionBridgeError.server(response.error ?? "Snapshot failed.")
        }
        return snapshot
    }

    func fetchWatcherFiles(profileId: String) async throws -> [CompanionWatcherFile] {
        let encoded = profileId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? profileId
        let response = try await fetch(CompanionWatcherFilesResponse.self, path: "/api/v1/watchers/files?profileId=\(encoded)")
        guard response.ok else { throw CompanionBridgeError.server(response.error ?? "Watcher scan failed.") }
        return response.files ?? []
    }

    func fetchPackDetail(folderPath: String) async throws -> CompanionPackDetail {
        let encoded = folderPath.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? folderPath
        let response = try await fetch(CompanionPackDetailResponse.self, path: "/api/v1/pack-detail?folderPath=\(encoded)")
        guard response.ok, let pack = response.pack else {
            throw CompanionBridgeError.server(response.error ?? "Pack detail failed.")
        }
        return pack
    }

    func pauseAfterCurrent() async throws {
        let response = try await post(CompanionActionEnvelope<CompanionEmptyActionData>.self, path: "/api/v1/actions/pause-after-current", payload: [:] as [String: String])
        guard response.ok else { throw CompanionBridgeError.server(response.error ?? "Pause failed.") }
    }

    func resumeQueue() async throws {
        let response = try await post(CompanionActionEnvelope<CompanionEmptyActionData>.self, path: "/api/v1/actions/resume-queue", payload: [:] as [String: String])
        guard response.ok else { throw CompanionBridgeError.server(response.error ?? "Resume failed.") }
    }

    func emergencyStop() async throws {
        let response = try await post(CompanionActionEnvelope<CompanionEmptyActionData>.self, path: "/api/v1/actions/emergency-stop", payload: [:] as [String: String])
        guard response.ok else { throw CompanionBridgeError.server(response.error ?? "Emergency stop failed.") }
    }

    func retryHistoryEntry(_ historyId: String) async throws {
        let response = try await post(CompanionActionEnvelope<CompanionEmptyActionData>.self, path: "/api/v1/actions/retry-history-entry", payload: ["historyId": historyId])
        guard response.ok else { throw CompanionBridgeError.server(response.error ?? "Retry failed.") }
    }

    func dismissBatch(_ submissionId: String) async throws {
        let response = try await post(CompanionActionEnvelope<CompanionEmptyActionData>.self, path: "/api/v1/actions/dismiss-batch", payload: ["submissionId": submissionId])
        guard response.ok else { throw CompanionBridgeError.server(response.error ?? "Dismiss batch failed.") }
    }

    func setWatcherRunning(profileId: String, running: Bool) async throws {
        let payload = WatcherRunPayload(profileId: profileId, running: running)
        let response = try await post(CompanionActionEnvelope<CompanionEmptyActionData>.self, path: "/api/v1/actions/set-watcher-running", payload: payload)
        guard response.ok else { throw CompanionBridgeError.server(response.error ?? "Watcher update failed.") }
    }

    func updateChecklistItem(folderPath: String, itemId: String, completed: Bool, completedDate: String) async throws -> CompanionPackDetail {
        let payload = ChecklistUpdatePayload(folderPath: folderPath, itemId: itemId, completed: completed, completedDate: completedDate, notes: nil)
        let response = try await post(CompanionActionEnvelope<CompanionPackDetail>.self, path: "/api/v1/actions/update-checklist-item", payload: payload)
        guard response.ok, let data = response.data else {
            throw CompanionBridgeError.server(response.error ?? "Checklist update failed.")
        }
        return data
    }

    func createInboxItem(kind: String, title: String, detail: String, folderPath: String, imageData: Data? = nil) async throws -> CompanionInboxItem {
        let payload = InboxCreatePayload(
            kind: kind,
            title: title,
            detail: detail,
            folderPath: folderPath,
            assetDataBase64: imageData?.base64EncodedString(),
            assetExtension: imageData == nil ? nil : "jpg"
        )
        let response = try await post(CompanionActionEnvelope<CompanionInboxItem>.self, path: "/api/v1/actions/create-inbox-item", payload: payload)
        guard response.ok, let data = response.data else {
            throw CompanionBridgeError.server(response.error ?? "Inbox save failed.")
        }
        return data
    }

    func markInboxReviewed(itemId: String) async throws -> CompanionInboxItem {
        let response = try await post(CompanionActionEnvelope<CompanionInboxItem>.self, path: "/api/v1/actions/mark-inbox-reviewed", payload: ["itemId": itemId])
        guard response.ok, let data = response.data else {
            throw CompanionBridgeError.server(response.error ?? "Inbox update failed.")
        }
        return data
    }
}

private struct ChecklistUpdatePayload: Encodable {
    let folderPath: String
    let itemId: String
    let completed: Bool
    let completedDate: String
    let notes: String?
}

private struct InboxCreatePayload: Encodable {
    let kind: String
    let title: String
    let detail: String
    let folderPath: String
    let assetDataBase64: String?
    let assetExtension: String?
}

private struct WatcherRunPayload: Encodable {
    let profileId: String
    let running: Bool
}

private struct AnyEncodable: Encodable {
    private let encodeImpl: (Encoder) throws -> Void

    init<T: Encodable>(_ wrapped: T) {
        self.encodeImpl = wrapped.encode
    }

    func encode(to encoder: Encoder) throws {
        try encodeImpl(encoder)
    }
}
