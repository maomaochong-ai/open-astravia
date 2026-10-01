import Foundation

/// File payloads of `file.list`, `file.stat` and `file.read` (port of the file
/// part of `api.ts`, ADR-0139).
///
/// `path` is always the desktop's canonical form and goes back to it as is:
/// relative to the session's working directory inside it ("" is the directory
/// itself), `~/…` under the home directory, absolute elsewhere. The phone never
/// builds a path.
public struct RemoteFileEntry: Equatable, Hashable, Sendable, Identifiable {
	public var name: String
	public var path: String
	public var isDirectory: Bool
	public var size: Double
	/// Milliseconds since the epoch.
	public var modifiedAt: Double

	public var id: String { path }

	public init(name: String, path: String, isDirectory: Bool, size: Double, modifiedAt: Double) {
		self.name = name
		self.path = path
		self.isDirectory = isDirectory
		self.size = size
		self.modifiedAt = modifiedAt
	}
}

public struct RemoteFileInfo: Equatable, Sendable {
	public var entry: RemoteFileEntry
	/// Guessed from the extension; a chunk's `mimeType` says what was sent.
	public var mimeType: String
	/// Where it lives, the home directory shown as `~`.
	public var displayPath: String

	public var name: String { entry.name }
	public var path: String { entry.path }

	public init(entry: RemoteFileEntry, mimeType: String, displayPath: String) {
		self.entry = entry
		self.mimeType = mimeType
		self.displayPath = displayPath
	}
}

public struct RemoteFileChunk: Equatable, Sendable {
	public var data: Data
	public var offset: Int
	/// Size of all the content being read; for images, the scaled-down copy.
	public var totalSize: Int
	public var modifiedAt: Double
	public var mimeType: String
}

public extension RemoteAPI {
	/// Most bytes one `file.read` returns, before base64.
	static let fileChunkBytes = 700 * 1024
	/// Largest file the phone previews, the desktop's own preview limit.
	static let maxFileBytes = 10 * 1024 * 1024

	private static func readFileEntry(_ value: JSONValue?) -> RemoteFileEntry? {
		guard let value, value.isObject,
		      let name = value["name"]?.stringValue, !name.isEmpty,
		      let path = value["path"]?.stringValue
		else { return nil }
		return RemoteFileEntry(
			name: name,
			path: path,
			isDirectory: value["isDirectory"]?.boolValue == true,
			size: value["size"]?.numberValue ?? 0,
			modifiedAt: value["modifiedAt"]?.numberValue ?? 0
		)
	}

	static func readFileEntries(_ value: JSONValue?) -> [RemoteFileEntry] {
		(value?["entries"]?.arrayValue ?? []).compactMap(readFileEntry)
	}

	static func readFileInfo(_ value: JSONValue?) -> RemoteFileInfo? {
		let file = value?["file"]
		guard let entry = readFileEntry(file) else { return nil }
		return RemoteFileInfo(
			entry: entry,
			mimeType: file?["mimeType"]?.stringValue ?? "application/octet-stream",
			displayPath: file?["displayPath"]?.stringValue ?? entry.path
		)
	}

	static func readFileChunk(_ value: JSONValue?) -> RemoteFileChunk? {
		guard let value, value.isObject,
		      let text = value["data"]?.stringValue, let data = Data(base64Encoded: text),
		      let offset = value["offset"]?.numberValue, let totalSize = value["totalSize"]?.numberValue
		else { return nil }
		return RemoteFileChunk(
			data: data,
			offset: Int(offset),
			totalSize: Int(totalSize),
			modifiedAt: value["modifiedAt"]?.numberValue ?? 0,
			mimeType: value["mimeType"]?.stringValue ?? "application/octet-stream"
		)
	}
}
