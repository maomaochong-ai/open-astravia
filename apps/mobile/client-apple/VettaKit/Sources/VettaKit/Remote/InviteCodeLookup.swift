import Foundation

/// What a connection code and password led to.
public enum InviteLookup: Equatable, Sendable {
	/// The pairing link, the same one the QR code carries.
	case found(String)
	/// No invite under this code: mistyped, already used, or expired.
	case notFound
	case wrongPassword
	/// The relay could not be reached or did not answer as one.
	case unreachable
}

/// Fetches the invite a desktop left on the relay under a connection code and opens it
/// with the password (ADR-0136). `get` returns the HTTP status and body, or nil when the
/// relay could not be reached; tests pass their own.
public struct InviteCodeLookup {
	public typealias Get = (_ url: String) async -> (status: Int, body: Data)?

	private let get: Get

	public init(get: @escaping Get = InviteCodeLookup.httpGet) {
		self.get = get
	}

	public func lookup(code: String, password: String, relayBaseUrl: String = InviteCode.defaultRelayBaseUrl) async -> InviteLookup {
		guard let normalized = InviteCode.normalize(code) else { return .notFound }
		guard InviteCode.isValidPassword(password) else { return .wrongPassword }
		guard let reply = await get(InviteCode.boxUrl(relayBaseUrl: relayBaseUrl, code: normalized)) else { return .unreachable }
		switch reply.status {
		case 200:
			guard let envelope = Self.readEnvelope(reply.body) else { return .unreachable }
			do {
				return .found(try await InviteCode.open(envelope, code: normalized, password: password))
			} catch {
				return .wrongPassword
			}
		case 404:
			return .notFound
		default:
			return .unreachable
		}
	}

	/// `{"envelope":{"v":1,"nonce":…,"ciphertext":…}}`, as the relay hands it out.
	static func readEnvelope(_ body: Data) -> InviteCode.Envelope? {
		guard let value = try? JSONValue.parse(body), let envelope = value["envelope"],
		      let nonce = envelope["nonce"]?.stringValue, let ciphertext = envelope["ciphertext"]?.stringValue
		else { return nil }
		return InviteCode.Envelope(nonce: nonce, ciphertext: ciphertext)
	}

	public static func httpGet(_ url: String) async -> (status: Int, body: Data)? {
		guard let url = URL(string: url) else { return nil }
		var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
		request.httpMethod = "GET"
		guard let (body, response) = try? await URLSession.shared.data(for: request),
		      let http = response as? HTTPURLResponse
		else { return nil }
		return (http.statusCode, body)
	}
}
