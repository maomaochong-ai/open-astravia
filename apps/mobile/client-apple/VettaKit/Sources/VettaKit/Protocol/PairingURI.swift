import Foundation

/// Everything a phone needs to reach one desktop, carried by the QR code (port of `pairing-uri.ts`).
public struct RemotePairingInvite: Equatable, Sendable {
	public static let version = 2
	public var pairingId: String
	public var mobileSecret: String
	public var desktopIdentityKey: String
	public var desktopName: String
	/// `host:port` pairs reachable on the local network, most preferred first.
	public var lanEndpoints: [String]
	/// Relay base URL (`wss://host`), nil when the desktop keeps cloud access off.
	public var relayBaseUrl: String?

	public init(pairingId: String, mobileSecret: String, desktopIdentityKey: String, desktopName: String, lanEndpoints: [String], relayBaseUrl: String? = nil) {
		self.pairingId = pairingId
		self.mobileSecret = mobileSecret
		self.desktopIdentityKey = desktopIdentityKey
		self.desktopName = desktopName
		self.lanEndpoints = lanEndpoints
		self.relayBaseUrl = relayBaseUrl
	}
}

public enum PairingURI {
	public static let scheme = "vetta"
	public static let host = "pair"

	private static let idPattern = try! NSRegularExpression(pattern: "^[A-Za-z0-9_-]{16,128}$")
	private static let hostPortPattern = try! NSRegularExpression(pattern: "^(\\[[0-9a-fA-F:.%a-zA-Z]+\\]|[A-Za-z0-9.-]+):(\\d{1,5})$")

	public static func build(_ invite: RemotePairingInvite) -> String {
		var params: [(String, String)] = [
			("v", String(RemotePairingInvite.version)),
			("id", invite.pairingId),
			("s", invite.mobileSecret),
			("k", invite.desktopIdentityKey),
			("n", invite.desktopName),
		]
		if !invite.lanEndpoints.isEmpty { params.append(("lan", invite.lanEndpoints.joined(separator: ","))) }
		if let relay = invite.relayBaseUrl, !relay.isEmpty { params.append(("relay", relay)) }
		let query = params.map { "\(formEncode($0.0))=\(formEncode($0.1))" }.joined(separator: "&")
		return "\(scheme)://\(host)?\(query)"
	}

	public static func parse(_ text: String) throws -> RemotePairingInvite {
		let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
		guard let components = URLComponents(string: trimmed), components.scheme != nil else {
			throw RemoteProtocolError("pairing link is not a valid URL")
		}
		guard components.scheme?.lowercased() == scheme, components.host?.lowercased() == host || components.path == "//\(host)" else {
			throw RemoteProtocolError("pairing link must start with vetta://pair")
		}
		let params = formDecode(components.percentEncodedQuery ?? "")
		guard params["v"] == String(RemotePairingInvite.version) else {
			throw RemoteProtocolError("pairing link version is unsupported")
		}
		let pairingId = params["id"] ?? ""
		let mobileSecret = params["s"] ?? ""
		let desktopIdentityKey = params["k"] ?? ""
		let desktopName = (params["n"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		guard matches(idPattern, pairingId) else { throw RemoteProtocolError("pairing link id is invalid") }
		guard matches(idPattern, mobileSecret) else { throw RemoteProtocolError("pairing link secret is invalid") }
		_ = try RemoteCrypto.decodePublicKey(desktopIdentityKey, field: "desktop identity key")
		guard !desktopName.isEmpty, desktopName.utf16.count <= 128 else {
			throw RemoteProtocolError("pairing link device name is invalid")
		}
		let lanEndpoints = (params["lan"] ?? "")
			.split(separator: ",", omittingEmptySubsequences: false)
			.map { $0.trimmingCharacters(in: .whitespaces) }
			.filter { !$0.isEmpty }
		for endpoint in lanEndpoints where !isValidHostPort(endpoint) {
			throw RemoteProtocolError("pairing link LAN endpoint is invalid")
		}
		return RemotePairingInvite(
			pairingId: pairingId,
			mobileSecret: mobileSecret,
			desktopIdentityKey: desktopIdentityKey,
			desktopName: desktopName,
			lanEndpoints: lanEndpoints,
			relayBaseUrl: normalizeRelayBaseUrl(params["relay"])
		)
	}

	public static func isValidHostPort(_ value: String) -> Bool {
		let range = NSRange(value.startIndex..., in: value)
		guard let match = hostPortPattern.firstMatch(in: value, range: range),
		      let portRange = Range(match.range(at: 2), in: value),
		      let port = Int(value[portRange])
		else { return false }
		return port >= 1 && port <= 65_535
	}

	/// Accepts http(s)/ws(s) and returns a `ws(s)://host[/path]` base without a trailing slash.
	public static func normalizeRelayBaseUrl(_ value: String?) -> String? {
		guard let value, !value.isEmpty,
		      let components = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
		      let host = components.host, !host.isEmpty
		else { return nil }
		let scheme: String
		switch components.scheme?.lowercased() {
		case "http", "ws": scheme = "ws"
		case "https", "wss": scheme = "wss"
		default: return nil
		}
		let port = components.port.map { ":\($0)" } ?? ""
		let path = components.percentEncodedPath.isEmpty ? "/" : components.percentEncodedPath
		var base = "\(scheme)://\(host.lowercased())\(port)\(path)"
		if base.hasSuffix("/") { base.removeLast() }
		return base
	}

	public static func lanControlUrl(endpoint: String, pairingId: String) -> String {
		"ws://\(endpoint)/v2/lan/\(uriComponent(pairingId))"
	}

	public static func relayControlUrl(relayBaseUrl: String, pairingId: String, role: RemoteRole) -> String {
		"\(relayBaseUrl)/v2/relay/\(uriComponent(pairingId))/\(role.rawValue)"
	}

	static func uriComponent(_ text: String) -> String {
		var allowed = CharacterSet.alphanumerics
		allowed.insert(charactersIn: "-_.!~*'()")
		return text.addingPercentEncoding(withAllowedCharacters: allowed) ?? text
	}

	/// application/x-www-form-urlencoded, as URLSearchParams serializes.
	static func formEncode(_ text: String) -> String {
		var allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
		allowed.insert(charactersIn: "*-._ ")
		let encoded = text.addingPercentEncoding(withAllowedCharacters: allowed) ?? text
		return encoded.replacingOccurrences(of: " ", with: "+")
	}

	/// URLSearchParams semantics: `+` is a space and the first value wins for `get`.
	static func formDecode(_ query: String) -> [String: String] {
		var result: [String: String] = [:]
		for pair in query.split(separator: "&", omittingEmptySubsequences: true) {
			let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
			let decode = { (raw: Substring) -> String in
				let spaced = raw.replacingOccurrences(of: "+", with: " ")
				return spaced.removingPercentEncoding ?? spaced
			}
			let key = decode(parts[0])
			let value = parts.count > 1 ? decode(parts[1]) : ""
			if result[key] == nil { result[key] = value }
		}
		return result
	}
}
