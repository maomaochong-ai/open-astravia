import Foundation
import Testing
@testable import VettaKit

@Suite struct ReplyLinkTests {
	private func classify(_ text: String) -> ReplyLink {
		ReplyLink.classify(URL(string: text)!)
	}

	@Test func sendsWebAndSystemSchemesToTheSystem() {
		#expect(classify("https://openvetta.com") == .system)
		#expect(classify("http://localhost:3000") == .system)
		#expect(classify("mailto:a@b.c") == .system)
		#expect(classify("tel:10086") == .system)
		#expect(classify("#section") == .system)
	}

	@Test func leavesEveryPathToTheDesktopAsWritten() {
		#expect(classify("./report.html") == .desktopFile("./report.html"))
		#expect(classify("out/a%20b.md") == .desktopFile("out/a%20b.md"))
		#expect(classify("/Users/me/Desktop/x.pdf") == .desktopFile("/Users/me/Desktop/x.pdf"))
		#expect(classify("file:///Users/me/x.pdf") == .desktopFile("file:///Users/me/x.pdf"))
		#expect(classify("C:/Users/me/x.md") == .desktopFile("C:/Users/me/x.md"))
		#expect(classify("README.md") == .desktopFile("README.md"))
	}
}

@Suite struct FilePreviewKindTests {
	private let text = Data("hello".utf8)

	@Test func picksTheRendererByExtensionThenContent() {
		#expect(FilePreviewKind.of(name: "a.md", mimeType: "text/markdown", data: text) == .markdown)
		#expect(FilePreviewKind.of(name: "index.HTML", mimeType: "text/html", data: text) == .html)
		#expect(FilePreviewKind.of(name: "a.pdf", mimeType: "application/pdf", data: text) == .quickLook)
		#expect(FilePreviewKind.of(name: "deck.pptx", mimeType: "application/octet-stream", data: text) == .quickLook)
		#expect(FilePreviewKind.of(name: "photo.heic", mimeType: "image/jpeg", data: text) == .quickLook)
		#expect(FilePreviewKind.of(name: "main.swift", mimeType: "application/octet-stream", data: text) == .text)
		#expect(FilePreviewKind.of(name: "Makefile", mimeType: "application/octet-stream", data: text) == .text)
		#expect(FilePreviewKind.of(name: "blob.bin", mimeType: "application/octet-stream", data: Data([0, 1, 2])) == .unsupported)
	}
}

@Suite struct RemoteFilePayloadTests {
	@Test func readsEntriesInfoAndChunks() {
		let entries = RemoteAPI.readFileEntries(["path": "", "entries": [
			["name": "out", "path": "out", "isDirectory": true, "size": 0, "modifiedAt": 3],
			["name": "a.md", "path": "a.md", "size": 12],
			["path": "nameless"],
		]])
		#expect(entries == [
			RemoteFileEntry(name: "out", path: "out", isDirectory: true, size: 0, modifiedAt: 3),
			RemoteFileEntry(name: "a.md", path: "a.md", isDirectory: false, size: 12, modifiedAt: 0),
		])
		let info = RemoteAPI.readFileInfo(["file": ["name": "x.pdf", "path": "~/Desktop/x.pdf", "size": 5, "modifiedAt": 9, "mimeType": "application/pdf", "displayPath": "~/Desktop/x.pdf"]])
		#expect(info?.path == "~/Desktop/x.pdf")
		#expect(info?.mimeType == "application/pdf")
		#expect(RemoteAPI.readFileInfo([:]) == nil)
		let chunk = RemoteAPI.readFileChunk(["data": "aGk=", "offset": 0, "totalSize": 2, "modifiedAt": 9, "mimeType": "text/plain"])
		#expect(chunk?.data == Data("hi".utf8))
		#expect(RemoteAPI.readFileChunk(["data": "aGk="]) == nil)
	}

	@Test func readsWhetherTheDesktopServesFiles() {
		let base: [String: JSONValue] = ["deviceName": "Mac", "lanEndpoints": [], "relayEnabled": true, "runningSessionCount": 0]
		var withFiles = base
		withFiles["fileRead"] = true
		#expect(RemoteAPI.readDeviceStatus(.object(withFiles))?.fileRead == true)
		#expect(RemoteAPI.readDeviceStatus(.object(base))?.fileRead == false)
		#expect(SessionPanel.files.isAvailable(on: RemoteAPI.readDeviceStatus(.object(withFiles))))
		#expect(!SessionPanel.files.isAvailable(on: nil))
	}
}

/// A desktop's `file.read` over some bytes, split into `chunk`-sized answers.
private final class ChunkedFile {
	var bytes: Data
	var modifiedAt: Double
	var chunk: Int
	var requests: [JSONValue] = []
	/// Rewrites the file right after answering this many requests.
	var rewriteAfter: Int?

	init(_ bytes: Data, modifiedAt: Double = 1, chunk: Int = 4) {
		self.bytes = bytes
		self.modifiedAt = modifiedAt
		self.chunk = chunk
	}

	func answer(_ payload: JSONValue) throws -> JSONValue? {
		requests.append(payload)
		if let expected = payload["modifiedAt"]?.numberValue, expected != modifiedAt {
			throw RemoteRequestError("changed", code: .fileChanged)
		}
		let offset = Int(payload["offset"]?.numberValue ?? 0)
		let slice = bytes.subdata(in: offset ..< min(bytes.count, offset + chunk))
		defer {
			if requests.count == rewriteAfter {
				bytes = Data("rewritten!".utf8)
				modifiedAt += 1
			}
		}
		return ["data": .string(slice.base64EncodedString()), "offset": .number(Double(offset)), "totalSize": .number(Double(bytes.count)), "modifiedAt": .number(modifiedAt), "mimeType": "text/plain"]
	}
}

@Suite struct RemoteFileReaderTests {
	@Test func joinsChunksPassingTheFirstChunksModificationTime() async throws {
		let file = ChunkedFile(Data("0123456789".utf8))
		let content = try await RemoteFileReader.read(path: "a.txt") { try file.answer($0) }
		#expect(content.data == Data("0123456789".utf8))
		#expect(file.requests.map { $0["offset"]?.numberValue } == [0, 4, 8])
		#expect(file.requests.first?["modifiedAt"] == nil)
		#expect(file.requests.dropFirst().allSatisfy { $0["modifiedAt"]?.numberValue == 1 })
	}

	@Test func startsOverWhenTheFileChangesMidRead() async throws {
		let file = ChunkedFile(Data("0123456789".utf8))
		file.rewriteAfter = 1
		let content = try await RemoteFileReader.read(path: "a.txt") { try file.answer($0) }
		#expect(content.data == Data("rewritten!".utf8))
		#expect(content.modifiedAt == 2)
	}

	@Test func refusesAFileOverTheLimitAfterTheFirstChunk() async {
		let file = ChunkedFile(Data("x".utf8))
		await #expect(throws: FileViewError.tooLarge) {
			_ = try await RemoteFileReader.read(path: "big") { _ in
				["data": "eA==", "offset": 0, "totalSize": .number(Double(RemoteAPI.maxFileBytes + 1)), "modifiedAt": 1, "mimeType": "text/plain"]
			}
		}
		_ = file
	}

	@Test func readsAnEmptyFile() async throws {
		let content = try await RemoteFileReader.read(path: "empty") { _ in
			["data": "", "offset": 0, "totalSize": 0, "modifiedAt": 1, "mimeType": "text/plain"]
		}
		#expect(content.data.isEmpty)
	}
}

@Suite struct FileContentCacheTests {
	private func info(_ path: String, modifiedAt: Double = 1) -> RemoteFileInfo {
		RemoteFileInfo(entry: RemoteFileEntry(name: path, path: path, isDirectory: false, size: 4, modifiedAt: modifiedAt), mimeType: "text/plain", displayPath: path)
	}

	private func content(_ bytes: Int) -> FileContent {
		FileContent(data: Data(count: bytes), mimeType: "text/plain", modifiedAt: 1)
	}

	@Test func missesAChangedFileAndDropsTheOldestOverBudget() {
		let cache = FileContentCache(budget: 10)
		cache.put("s", info("a"), content(4))
		cache.put("s", info("b"), content(4))
		#expect(cache.get("s", info("a")) != nil)
		#expect(cache.get("s", info("a", modifiedAt: 2)) == nil, "a rewritten file is fetched again")
		#expect(cache.get("other", info("a")) == nil, "each session resolves paths on its own")
		cache.put("s", info("c"), content(4))
		#expect(cache.get("s", info("b")) == nil, "b was the least recently used")
		#expect(cache.get("s", info("a")) != nil)
	}
}

@Suite struct FileViewErrorTests {
	@Test func explainsWhatTheDesktopAnswered() {
		#expect(FileViewError.from(RemoteRequestError("x", code: .forbidden)) == .forbidden)
		#expect(FileViewError.from(RemoteRequestError("x", code: .notFound)) == .notFound)
		#expect(FileViewError.from(RemoteRequestError("x", code: .tooLarge)) == .tooLarge)
		#expect(FileViewError.from(LinkOfflineError()) == .offline)
		#expect(FileViewError.from(RemoteRequestError("x")) == .failed)
	}
}

/// The phone against a scripted desktop that does or does not serve files.
@Suite(.serialized) struct AppModelFileTests {
	/// Returns the desktop too: its connections hold it weakly, so it must outlive the test's requests.
	private func pairedModel(servesFiles: Bool, log: RequestLog) async throws -> (AppModel, FakeDesktop) {
		let desktop = FakeDesktop()
		desktop.onHello = { _ in .approve }
		let file = ChunkedFile(Data("# 周报\n本周完成".utf8), chunk: 8)
		desktop.onRequest = { connection, request in
			log.entries.append(request)
			switch request.method {
			case .sessionList:
				var status: [String: JSONValue] = ["deviceName": "MacBook Pro", "lanEndpoints": [], "relayEnabled": false, "runningSessionCount": 0]
				if servesFiles { status["fileRead"] = true }
				try? connection.respond(requestId: request.requestId, success: true, payload: ["sessions": [
					["id": "s1", "projectCwd": "/conv", "projectName": "对话", "title": "周报", "updatedAt": 1, "status": "idle", "live": false],
				]])
				_ = try? connection.emitEvent(.deviceStatus, payload: .object(status))
			case .fileList:
				try? connection.respond(requestId: request.requestId, success: true, payload: ["path": "", "entries": [
					["name": "out", "path": "out", "isDirectory": true, "size": 0, "modifiedAt": 1],
					["name": "周报.md", "path": "周报.md", "isDirectory": false, "size": 20, "modifiedAt": 1],
				]])
			case .fileStat where request.payload?["path"]?.stringValue == "~/.ssh/id_rsa":
				try? connection.respond(requestId: request.requestId, success: false, error: RemoteError(code: .forbidden, message: "no", retryable: false))
			case .fileStat:
				try? connection.respond(requestId: request.requestId, success: true, payload: ["file": ["name": "周报.md", "path": "周报.md", "isDirectory": false, "size": .number(Double(file.bytes.count)), "modifiedAt": 1, "mimeType": "text/markdown", "displayPath": "~/.vetta/conversation/s1/周报.md"]])
			case .fileRead:
				do {
					try connection.respond(requestId: request.requestId, success: true, payload: file.answer(request.payload ?? [:]))
				} catch {
					try? connection.respond(requestId: request.requestId, success: false, error: RemoteError(code: .fileChanged, message: "changed", retryable: true))
				}
			default:
				try? connection.respond(requestId: request.requestId, success: true, payload: [:])
			}
		}
		let model = AppModel(platform: .memory(createTransport: desktop.createTransport))
		model.start()
		let invite = PairingURI.build(RemotePairingInvite(pairingId: "pair-1234567890abcdef", mobileSecret: "secret-1234567890abcdef", desktopIdentityKey: desktop.identityKey, desktopName: "MacBook Pro", lanEndpoints: ["192.168.1.20:43117"]))
		#expect(await model.pairWithCode(invite))
		#expect(await eventually { model.sessions.map(\.id) == ["s1"] && model.link.desktop != nil })
		return (model, desktop)
	}

	@Test func neverSendsFileRequestsToADesktopThatDoesNotServeThem() async throws {
		let log = RequestLog()
		let (model, desktop) = try await pairedModel(servesFiles: false, log: log)
		defer { withExtendedLifetime(desktop) {} }
		#expect(!model.isAvailable(.files))
		await #expect(throws: FileViewError.unsupportedDesktop) { _ = try await model.listFiles("s1", path: "") }
		await #expect(throws: FileViewError.unsupportedDesktop) { _ = try await model.statFile("s1", path: "./a.md") }
		#expect(!log.entries.contains { [.fileList, .fileStat, .fileRead].contains($0.method) })
	}

	@Test func listsDescribesAndReadsFilesOnceWhileUnchanged() async throws {
		let log = RequestLog()
		let (model, desktop) = try await pairedModel(servesFiles: true, log: log)
		defer { withExtendedLifetime(desktop) {} }
		#expect(model.isAvailable(.files))

		let listing = try await model.listFiles("s1", path: "")
		#expect(listing.entries.map(\.path) == ["out", "周报.md"])
		#expect(log.entries.last?.sessionId == "s1")

		let info = try await model.statFile("s1", path: "./周报.md")
		#expect(info.displayPath == "~/.vetta/conversation/s1/周报.md")
		let content = try await model.readFile("s1", info)
		#expect(String(data: content.data, encoding: .utf8) == "# 周报\n本周完成")
		let reads = log.entries.count { $0.method == .fileRead }
		#expect(reads > 1, "a file larger than one chunk takes several reads")
		_ = try await model.readFile("s1", info)
		#expect(log.entries.count { $0.method == .fileRead } == reads, "an unchanged file comes from memory")

		await #expect(throws: FileViewError.forbidden) { _ = try await model.statFile("s1", path: "~/.ssh/id_rsa") }
		let folder = RemoteFileInfo(entry: listing.entries[0], mimeType: "inode/directory", displayPath: "out")
		await #expect(throws: FileViewError.notAFile) { _ = try await model.readFile("s1", folder) }
	}
}
