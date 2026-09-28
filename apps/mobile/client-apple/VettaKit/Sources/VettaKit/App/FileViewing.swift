import Foundation

/// Viewing the desktop's files from the phone (ADR-0139): which reply links
/// point at them, how a file is fetched in chunks, how it is shown, and the
/// panels a chat's More menu offers.

/// What tapping a link in a reply does.
public enum ReplyLink: Equatable, Sendable {
	/// A web page or a system scheme (`mailto:`, `tel:`…); the system opens it.
	case system
	/// A file on the desktop; the text is the link as written, which the desktop resolves.
	case desktopFile(String)

	/// Web addresses and anything with its own scheme go to the system; everything
	/// else (relative and absolute paths, `file://`, `~/…`, Windows drives) is a desktop
	/// file, left to the desktop to resolve rather than guessed at here.
	public static func classify(_ url: URL) -> ReplyLink {
		let href = url.absoluteString
		guard !href.isEmpty, !href.hasPrefix("#") else { return .system }
		guard let scheme = url.scheme?.lowercased() else { return .desktopFile(href) }
		// `C:/x` parses with the drive letter as its scheme.
		if scheme == "file" || scheme.count == 1 { return .desktopFile(href) }
		return .system
	}
}

/// How the phone shows a file.
public enum FilePreviewKind: Equatable, Sendable {
	case markdown
	case html
	/// Code and other text, shown as it is.
	case text
	/// Anything Quick Look renders: images, PDF, Office and iWork documents, CSV, media.
	case quickLook
	case unsupported

	private static let quickLookExtensions: Set<String> = [
		"png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff", "ico", "svg",
		"pdf", "rtf", "csv", "tsv",
		"doc", "docx", "xls", "xlsx", "ppt", "pptx", "key", "pages", "numbers",
		"mp3", "m4a", "wav", "aac", "mp4", "m4v", "mov", "usdz",
	]

	/// Decided by extension first; anything else is text when its content decodes as text.
	public static func of(name: String, mimeType: String, data: Data) -> FilePreviewKind {
		let ext = FileNames.extensionOf(name)
		switch ext {
		case "md", "markdown", "mdx": return .markdown
		case "html", "htm", "xhtml": return .html
		default: break
		}
		// A scaled-down photo arrives as JPEG whatever its extension was.
		if mimeType.hasPrefix("image/") || quickLookExtensions.contains(ext) { return .quickLook }
		return FileText.decode(data) == nil ? .unsupported : .text
	}
}

public enum FileNames {
	/// Lower-cased, without the dot; empty when there is none.
	public static func extensionOf(_ name: String) -> String {
		guard let dot = name.lastIndex(of: ".") else { return "" }
		return String(name[name.index(after: dot)...]).lowercased()
	}

	/// The last path component, or the desktop directory's own name when there is none.
	public static func title(ofDirectory path: String, root: String) -> String {
		path.split(separator: "/").last.map(String.init) ?? root
	}
}

public enum FileText {
	/// The content as text when it is UTF-8 without NUL bytes; binary otherwise.
	public static func decode(_ data: Data) -> String? {
		if data.prefix(8192).contains(0) { return nil }
		return String(data: data, encoding: .utf8)
	}
}

/// Why a file cannot be shown, in terms the phone can explain.
public enum FileViewError: Error, Equatable, Sendable {
	/// The desktop predates file viewing.
	case unsupportedDesktop
	case offline
	/// Outside what the phone may read, or in a sensitive location.
	case forbidden
	case notFound
	case tooLarge
	/// A folder where a file was expected.
	case notAFile
	case failed

	public static func from(_ error: Error) -> FileViewError {
		if let error = error as? FileViewError { return error }
		if error is LinkOfflineError { return .offline }
		switch (error as? RemoteRequestError)?.code {
		case .forbidden: return .forbidden
		case .notFound: return .notFound
		case .tooLarge: return .tooLarge
		case .transportClosed, .requestTimeout: return .offline
		default: return .failed
		}
	}

	@MainActor public var message: String {
		switch self {
		case .unsupportedDesktop: L10n.Files.needsDesktopUpdate
		case .offline: L10n.Common.notConnected
		case .forbidden: L10n.Files.forbidden
		case .notFound: L10n.Files.notFound
		case .tooLarge: L10n.Files.tooLarge
		case .notAFile: L10n.Files.notAFile
		case .failed: L10n.Files.loadFailed
		}
	}
}

/// A folder of the session's working directory as the desktop listed it.
public struct FileListing: Equatable, Sendable {
	public var path: String
	public var entries: [RemoteFileEntry]

	public init(path: String, entries: [RemoteFileEntry]) {
		self.path = path
		self.entries = entries
	}
}

/// A whole file as it arrived: the bytes the desktop sent and their type.
public struct FileContent: Equatable, Sendable {
	public var data: Data
	public var mimeType: String
	public var modifiedAt: Double

	public init(data: Data, mimeType: String, modifiedAt: Double) {
		self.data = data
		self.mimeType = mimeType
		self.modifiedAt = modifiedAt
	}
}

/// Fetches a file chunk by chunk with `file.read`, starting over once when the
/// desktop reports it changed mid-read.
public enum RemoteFileReader {
	public typealias Request = (JSONValue) async throws -> JSONValue?

	public static func read(path: String, request: Request) async throws -> FileContent {
		var attempts = 0
		while true {
			attempts += 1
			do {
				return try await readOnce(path: path, request: request)
			} catch let error as RemoteRequestError where error.code == .fileChanged && attempts < 3 {
				continue
			}
		}
	}

	private static func readOnce(path: String, request: Request) async throws -> FileContent {
		var data = Data()
		var first: RemoteFileChunk?
		repeat {
			var payload: [String: JSONValue] = ["path": .string(path), "offset": .number(Double(data.count))]
			if let first { payload["modifiedAt"] = .number(first.modifiedAt) }
			guard let chunk = RemoteAPI.readFileChunk(try await request(.object(payload))), chunk.offset == data.count else {
				throw FileViewError.failed
			}
			if first == nil {
				guard chunk.totalSize <= RemoteAPI.maxFileBytes else { throw FileViewError.tooLarge }
				first = chunk
				data.reserveCapacity(chunk.totalSize)
			}
			// An empty chunk before the end would loop forever.
			guard !chunk.data.isEmpty || data.count >= chunk.totalSize else { throw FileViewError.failed }
			data.append(chunk.data)
		} while data.count < first?.totalSize ?? 0
		guard let first else { throw FileViewError.failed }
		return FileContent(data: data, mimeType: first.mimeType, modifiedAt: first.modifiedAt)
	}
}

/// Files already fetched this launch, so opening one again costs nothing while it
/// is unchanged. Keyed by the file's size and modification time as well, so a
/// rewritten file is fetched afresh. Bounded by bytes, oldest dropped first.
public final class FileContentCache {
	private var entries: [String: FileContent] = [:]
	private var order: [String] = []
	private var bytes = 0
	private let budget: Int

	public init(budget: Int = 48 * 1024 * 1024) {
		self.budget = budget
	}

	static func key(_ sessionId: String, _ info: RemoteFileInfo) -> String {
		"\(sessionId)\u{0}\(info.path)\u{0}\(info.entry.modifiedAt)\u{0}\(info.entry.size)"
	}

	public func get(_ sessionId: String, _ info: RemoteFileInfo) -> FileContent? {
		let key = Self.key(sessionId, info)
		guard let content = entries[key] else { return nil }
		order.removeAll { $0 == key }
		order.append(key)
		return content
	}

	public func put(_ sessionId: String, _ info: RemoteFileInfo, _ content: FileContent) {
		let key = Self.key(sessionId, info)
		if let old = entries[key] {
			bytes -= old.data.count
			order.removeAll { $0 == key }
		}
		entries[key] = content
		order.append(key)
		bytes += content.data.count
		while bytes > budget, order.count > 1 {
			let oldest = order.removeFirst()
			bytes -= entries.removeValue(forKey: oldest)?.data.count ?? 0
		}
	}

	public func removeAll() {
		entries = [:]
		order = []
		bytes = 0
	}
}

/// What a chat's More menu can open, the phone's counterpart of the desktop's
/// activity panel tabs. New tabs are added here and given a view.
public enum SessionPanel: String, CaseIterable, Identifiable, Sendable {
	case files

	public var id: String { rawValue }

	public var title: String {
		switch self {
		case .files: L10n.Files.title
		}
	}

	public var systemImage: String {
		switch self {
		case .files: "folder"
		}
	}

	/// Whether the connected desktop can serve it; nil status means none has arrived yet.
	public func isAvailable(on desktop: RemoteDeviceStatus?) -> Bool {
		switch self {
		case .files: desktop?.fileRead == true
		}
	}
}
