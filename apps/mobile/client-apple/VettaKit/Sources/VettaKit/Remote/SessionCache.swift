import Foundation
import SQLite3

/// Offline copy of what the desktop last told us, keyed by desktop (port of
/// `cache.ts`). Sessions are capped at the most recent `limit`; transcripts of
/// evicted sessions go with them.
public protocol SessionCache: AnyObject {
	func loadSessions(_ desktopKey: String) -> [RemoteSessionSummary]
	func saveSessions(_ desktopKey: String, _ sessions: [RemoteSessionSummary])
	func loadTranscript(_ desktopKey: String, _ sessionId: String) -> [TranscriptItem]?
	func saveTranscript(_ desktopKey: String, _ sessionId: String, _ items: [TranscriptItem])
	func clearDesktop(_ desktopKey: String)
}

public enum SessionCacheLimit {
	public static let sessions = 50

	public static func keepMostRecent(_ sessions: [RemoteSessionSummary]) -> [RemoteSessionSummary] {
		Array(sessions.sorted { $0.updatedAt > $1.updatedAt }.prefix(Self.sessions))
	}
}

public final class MemorySessionCache: SessionCache {
	private var sessions: [String: [RemoteSessionSummary]] = [:]
	private var transcripts: [String: [String: [TranscriptItem]]] = [:]

	public init() {}

	public func loadSessions(_ desktopKey: String) -> [RemoteSessionSummary] { sessions[desktopKey] ?? [] }

	public func saveSessions(_ desktopKey: String, _ list: [RemoteSessionSummary]) {
		let kept = SessionCacheLimit.keepMostRecent(list)
		sessions[desktopKey] = kept
		let keep = Set(kept.map(\.id))
		transcripts[desktopKey] = transcripts[desktopKey]?.filter { keep.contains($0.key) }
	}

	public func loadTranscript(_ desktopKey: String, _ sessionId: String) -> [TranscriptItem]? {
		transcripts[desktopKey]?[sessionId]
	}

	public func saveTranscript(_ desktopKey: String, _ sessionId: String, _ items: [TranscriptItem]) {
		guard sessions[desktopKey]?.contains(where: { $0.id == sessionId }) == true else { return }
		transcripts[desktopKey, default: [:]][sessionId] = items
	}

	public func clearDesktop(_ desktopKey: String) {
		sessions[desktopKey] = nil
		transcripts[desktopKey] = nil
	}
}

/// SQLite-backed cache in Application Support; payloads are JSON so a schema
/// change in the view model never needs a migration, only a cache miss.
public final class SQLiteSessionCache: SessionCache {
	nonisolated(unsafe) private var db: OpaquePointer?
	private let encoder = JSONEncoder()
	private let decoder = JSONDecoder()
	private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

	public init(path: String) {
		guard sqlite3_open(path, &db) == SQLITE_OK else {
			db = nil
			return
		}
		exec("""
		CREATE TABLE IF NOT EXISTS sessions (
		  desktop_key TEXT NOT NULL,
		  session_id TEXT NOT NULL,
		  updated_at REAL NOT NULL,
		  payload TEXT NOT NULL,
		  PRIMARY KEY (desktop_key, session_id)
		);
		CREATE INDEX IF NOT EXISTS sessions_by_desktop ON sessions(desktop_key, updated_at DESC);
		CREATE TABLE IF NOT EXISTS transcripts (
		  desktop_key TEXT NOT NULL,
		  session_id TEXT NOT NULL,
		  payload TEXT NOT NULL,
		  PRIMARY KEY (desktop_key, session_id)
		);
		""")
	}

	public static func defaultPath() -> String {
		let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
		try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
		return base.appendingPathComponent("vetta-cache.sqlite").path
	}

	deinit {
		sqlite3_close(db)
	}

	public func loadSessions(_ desktopKey: String) -> [RemoteSessionSummary] {
		query("SELECT payload FROM sessions WHERE desktop_key = ? ORDER BY updated_at DESC", [desktopKey]).compactMap {
			try? decoder.decode(RemoteSessionSummary.self, from: Data($0.utf8))
		}
	}

	public func saveSessions(_ desktopKey: String, _ list: [RemoteSessionSummary]) {
		let kept = SessionCacheLimit.keepMostRecent(list)
		exec("BEGIN")
		run("DELETE FROM sessions WHERE desktop_key = ?", [desktopKey])
		for session in kept {
			guard let data = try? encoder.encode(session), let payload = String(data: data, encoding: .utf8) else { continue }
			run("INSERT OR REPLACE INTO sessions (desktop_key, session_id, updated_at, payload) VALUES (?, ?, ?, ?)", [desktopKey, session.id, session.updatedAt, payload])
		}
		run("DELETE FROM transcripts WHERE desktop_key = ? AND session_id NOT IN (SELECT session_id FROM sessions WHERE desktop_key = ?)", [desktopKey, desktopKey])
		exec("COMMIT")
	}

	public func loadTranscript(_ desktopKey: String, _ sessionId: String) -> [TranscriptItem]? {
		guard let payload = query("SELECT payload FROM transcripts WHERE desktop_key = ? AND session_id = ?", [desktopKey, sessionId]).first else { return nil }
		return try? decoder.decode([TranscriptItem].self, from: Data(payload.utf8))
	}

	public func saveTranscript(_ desktopKey: String, _ sessionId: String, _ items: [TranscriptItem]) {
		guard !query("SELECT session_id FROM sessions WHERE desktop_key = ? AND session_id = ?", [desktopKey, sessionId]).isEmpty,
		      let data = try? encoder.encode(items), let payload = String(data: data, encoding: .utf8)
		else { return }
		run("INSERT OR REPLACE INTO transcripts (desktop_key, session_id, payload) VALUES (?, ?, ?)", [desktopKey, sessionId, payload])
	}

	public func clearDesktop(_ desktopKey: String) {
		exec("BEGIN")
		run("DELETE FROM sessions WHERE desktop_key = ?", [desktopKey])
		run("DELETE FROM transcripts WHERE desktop_key = ?", [desktopKey])
		exec("COMMIT")
	}

	private func exec(_ sql: String) {
		guard let db else { return }
		sqlite3_exec(db, sql, nil, nil, nil)
	}

	private func prepare(_ sql: String, _ bindings: [Any]) -> OpaquePointer? {
		guard let db else { return nil }
		var statement: OpaquePointer?
		guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return nil }
		for (index, value) in bindings.enumerated() {
			let position = Int32(index + 1)
			switch value {
			case let text as String: sqlite3_bind_text(statement, position, text, -1, Self.transient)
			case let number as Double: sqlite3_bind_double(statement, position, number)
			default: sqlite3_bind_null(statement, position)
			}
		}
		return statement
	}

	private func run(_ sql: String, _ bindings: [Any]) {
		guard let statement = prepare(sql, bindings) else { return }
		sqlite3_step(statement)
		sqlite3_finalize(statement)
	}

	/// Returns the first column of every row as text.
	private func query(_ sql: String, _ bindings: [Any]) -> [String] {
		guard let statement = prepare(sql, bindings) else { return [] }
		defer { sqlite3_finalize(statement) }
		var rows: [String] = []
		while sqlite3_step(statement) == SQLITE_ROW {
			if let text = sqlite3_column_text(statement, 0) { rows.append(String(cString: text)) }
		}
		return rows
	}
}
