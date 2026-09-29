import Foundation

/// `vetta://session?id=…`: opens one session's chat, from a notification or the Live Activity.
public enum SessionLink {
	static let host = "session"

	public static func url(_ sessionId: String) -> URL {
		var components = URLComponents()
		components.scheme = PairingURI.scheme
		components.host = host
		components.queryItems = [URLQueryItem(name: "id", value: sessionId)]
		return components.url!
	}

	/// The session a link opens, or nil when it is not a session link.
	public static func sessionId(_ url: URL) -> String? {
		guard url.scheme?.lowercased() == PairingURI.scheme, url.host?.lowercased() == host,
		      let id = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "id" })?.value,
		      !id.isEmpty
		else { return nil }
		return id
	}
}
