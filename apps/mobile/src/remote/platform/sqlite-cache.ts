import type { RemoteSessionSummary } from "@vetta/remote-control";
import { readSessionSummary } from "@vetta/remote-control";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { keepMostRecent, type SessionCache } from "../cache";
import type { TranscriptItem } from "../transcript";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  desktop_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
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
`;

/** expo-sqlite implementation of the offline cache. */
export class SqliteSessionCache implements SessionCache {
	private database: Promise<SQLiteDatabase> | undefined;

	private async db(): Promise<SQLiteDatabase> {
		if (!this.database) {
			this.database = openDatabaseAsync("vetta-cache.db").then(async (database) => {
				await database.execAsync(SCHEMA);
				return database;
			});
		}
		return this.database;
	}

	async loadSessions(desktopKey: string): Promise<RemoteSessionSummary[]> {
		const db = await this.db();
		const rows = await db.getAllAsync<{ payload: string }>(
			"SELECT payload FROM sessions WHERE desktop_key = ? ORDER BY updated_at DESC",
			desktopKey,
		);
		return rows.flatMap((row) => {
			const parsed = readSessionSummary(safeParse(row.payload));
			return parsed ? [parsed] : [];
		});
	}

	async saveSessions(desktopKey: string, sessions: readonly RemoteSessionSummary[]): Promise<void> {
		const db = await this.db();
		const kept = keepMostRecent(sessions);
		await db.withTransactionAsync(async () => {
			await db.runAsync("DELETE FROM sessions WHERE desktop_key = ?", desktopKey);
			for (const session of kept) {
				await db.runAsync(
					"INSERT OR REPLACE INTO sessions (desktop_key, session_id, updated_at, payload) VALUES (?, ?, ?, ?)",
					desktopKey,
					session.id,
					session.updatedAt,
					JSON.stringify(session),
				);
			}
			await db.runAsync(
				"DELETE FROM transcripts WHERE desktop_key = ? AND session_id NOT IN (SELECT session_id FROM sessions WHERE desktop_key = ?)",
				desktopKey,
				desktopKey,
			);
		});
	}

	async loadTranscript(desktopKey: string, sessionId: string): Promise<readonly TranscriptItem[] | undefined> {
		const db = await this.db();
		const row = await db.getFirstAsync<{ payload: string }>(
			"SELECT payload FROM transcripts WHERE desktop_key = ? AND session_id = ?",
			desktopKey,
			sessionId,
		);
		if (!row) return undefined;
		const parsed = safeParse(row.payload);
		return Array.isArray(parsed) ? (parsed as TranscriptItem[]) : undefined;
	}

	async saveTranscript(desktopKey: string, sessionId: string, items: readonly TranscriptItem[]): Promise<void> {
		const db = await this.db();
		const known = await db.getFirstAsync<{ session_id: string }>(
			"SELECT session_id FROM sessions WHERE desktop_key = ? AND session_id = ?",
			desktopKey,
			sessionId,
		);
		if (!known) return;
		await db.runAsync(
			"INSERT OR REPLACE INTO transcripts (desktop_key, session_id, payload) VALUES (?, ?, ?)",
			desktopKey,
			sessionId,
			JSON.stringify(items),
		);
	}

	async clearDesktop(desktopKey: string): Promise<void> {
		const db = await this.db();
		await db.withTransactionAsync(async () => {
			await db.runAsync("DELETE FROM sessions WHERE desktop_key = ?", desktopKey);
			await db.runAsync("DELETE FROM transcripts WHERE desktop_key = ?", desktopKey);
		});
	}
}

function safeParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}
