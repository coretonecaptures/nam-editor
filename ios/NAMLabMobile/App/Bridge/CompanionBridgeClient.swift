import Foundation

protocol CompanionBridgeClientProtocol {
    func fetchSnapshot(settings: BridgeSettings) async throws -> CompanionSnapshot
    func send(_ action: CompanionControlAction, settings: BridgeSettings) async throws -> CompanionActionFeedback
}

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

struct LiveCompanionBridgeClient: CompanionBridgeClientProtocol {
    private let decoder = JSONDecoder()

    func fetchSnapshot(settings: BridgeSettings) async throws -> CompanionSnapshot {
        let request = try request(settings: settings, path: "/api/v1/snapshot")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            throw CompanionBridgeError.invalidResponse
        }
        let envelope = try decoder.decode(CompanionSnapshotResponse.self, from: data)
        guard envelope.ok, let snapshot = envelope.snapshot else {
            throw CompanionBridgeError.server(envelope.error ?? "Snapshot failed.")
        }
        return snapshot
    }

    func send(_ action: CompanionControlAction, settings: BridgeSettings) async throws -> CompanionActionFeedback {
        let path: String
        let message: String
        switch action {
        case .pauseAfterCurrent:
            path = "/api/v1/actions/pause-after-current"
            message = "Queue will pause after the current run."
        case .resumeQueue:
            path = "/api/v1/actions/resume-queue"
            message = "Queue resumed."
        case .emergencyStop:
            path = "/api/v1/actions/emergency-stop"
            message = "Emergency stop sent."
        }

        let body = try JSONEncoder().encode([String: String]())
        let request = try request(settings: settings, path: path, method: "POST", body: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw CompanionBridgeError.invalidResponse
        }
        let envelope = try decoder.decode(CompanionActionEnvelope<CompanionEmptyActionData>.self, from: data)
        guard 200..<300 ~= http.statusCode, envelope.ok else {
            throw CompanionBridgeError.server(envelope.error ?? "Action failed.")
        }
        return CompanionActionFeedback(message: message)
    }

    private func request(settings: BridgeSettings, path: String, method: String = "GET", body: Data? = nil) throws -> URLRequest {
        guard let baseURL = baseURL(for: settings) else { throw CompanionBridgeError.missingHost }
        guard !settings.token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw CompanionBridgeError.missingToken
        }

        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("Bearer \(settings.token.trimmingCharacters(in: .whitespacesAndNewlines))", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        return request
    }

    private func baseURL(for settings: BridgeSettings) -> URL? {
        let raw = settings.host.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return nil }
        let withScheme = raw.contains("://") ? raw : "http://\(raw)"
        guard var components = URLComponents(string: withScheme) else { return nil }
        if components.port == nil {
            components.port = 38571
        }
        return components.url
    }
}
