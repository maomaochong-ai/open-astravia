package org.vetta.android.data.remote

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteDriver
import androidx.sqlite.SQLiteStatement
import androidx.sqlite.execSQL
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import org.vetta.android.domain.remote.RemoteSessionSummary
import org.vetta.android.domain.remote.TranscriptItem

/**
 * Offline copy of what the desktop last told us, keyed by desktop (port of the
 * iOS `SessionCache.swift`). Sessions are capped at the most recent
 * [SessionCacheLimit.SESSIONS]; transcripts of evicted sessions go with them.
 */
interface SessionCache {
    fun loadSessions(desktopKey: String): List<RemoteSessionSummary>

    fun saveSessions(desktopKey: String, sessions: List<RemoteSessionSummary>)

    fun loadTranscript(desktopKey: String, sessionId: String): List<TranscriptItem>?

    fun saveTranscript(desktopKey: String, sessionId: String, items: List<TranscriptItem>)

    fun clearDesktop(desktopKey: String)
}

object SessionCacheLimit {
    const val SESSIONS = 50

    fun keepMostRecent(sessions: List<RemoteSessionSummary>): List<RemoteSessionSummary> =
        sessions.sortedByDescending { it.updatedAt }.take(SESSIONS)
}

class MemorySessionCache : SessionCache {
    private val sessions = mutableMapOf<String, List<RemoteSessionSummary>>()
    private val transcripts = mutableMapOf<String, MutableMap<String, List<TranscriptItem>>>()

    override fun loadSessions(desktopKey: String): List<RemoteSessionSummary> = sessions[desktopKey].orEmpty()

    override fun saveSessions(desktopKey: String, sessions: List<RemoteSessionSummary>) {
        val kept = SessionCacheLimit.keepMostRecent(sessions)
        this.sessions[desktopKey] = kept
        val keep = kept.map { it.id }.toSet()
        transcripts[desktopKey]?.keys?.retainAll(keep)
    }

    override fun loadTranscript(desktopKey: String, sessionId: String): List<TranscriptItem>? = transcripts[desktopKey]?.get(sessionId)

    override fun saveTranscript(desktopKey: String, sessionId: String, items: List<TranscriptItem>) {
        if (sessions[desktopKey]?.any { it.id == sessionId } != true) return
        transcripts.getOrPut(desktopKey) { mutableMapOf() }[sessionId] = items
    }

    override fun clearDesktop(desktopKey: String) {
        sessions.remove(desktopKey)
        transcripts.remove(desktopKey)
    }
}

/**
 * SQLite-backed cache; payloads are JSON so a change in the view model never
 * needs a migration, only a cache miss. A database that cannot be opened
 * leaves the cache empty rather than failing the app.
 */
class SqliteSessionCache(driver: SQLiteDriver, path: String) : SessionCache {
    private val db: SQLiteConnection? =
        runCatching {
            driver.open(path).also { connection ->
                connection.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS sessions (
                      desktop_key TEXT NOT NULL,
                      session_id TEXT NOT NULL,
                      updated_at INTEGER NOT NULL,
                      payload TEXT NOT NULL,
                      PRIMARY KEY (desktop_key, session_id)
                    )
                    """.trimIndent(),
                )
                connection.execSQL("CREATE INDEX IF NOT EXISTS sessions_by_desktop ON sessions(desktop_key, updated_at DESC)")
                connection.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS transcripts (
                      desktop_key TEXT NOT NULL,
                      session_id TEXT NOT NULL,
                      payload TEXT NOT NULL,
                      PRIMARY KEY (desktop_key, session_id)
                    )
                    """.trimIndent(),
                )
            }
        }.getOrNull()

    override fun loadSessions(desktopKey: String): List<RemoteSessionSummary> =
        query("SELECT payload FROM sessions WHERE desktop_key = ? ORDER BY updated_at DESC", desktopKey).mapNotNull {
            runCatching { json.decodeFromString(RemoteSessionSummary.serializer(), it) }.getOrNull()
        }

    override fun saveSessions(desktopKey: String, sessions: List<RemoteSessionSummary>) {
        val kept = SessionCacheLimit.keepMostRecent(sessions)
        transaction {
            run("DELETE FROM sessions WHERE desktop_key = ?", desktopKey)
            for (session in kept) {
                run(
                    "INSERT OR REPLACE INTO sessions (desktop_key, session_id, updated_at, payload) VALUES (?, ?, ?, ?)",
                    desktopKey,
                    session.id,
                    session.updatedAt,
                    json.encodeToString(RemoteSessionSummary.serializer(), session),
                )
            }
            run(
                "DELETE FROM transcripts WHERE desktop_key = ? AND session_id NOT IN (SELECT session_id FROM sessions WHERE desktop_key = ?)",
                desktopKey,
                desktopKey,
            )
        }
    }

    override fun loadTranscript(desktopKey: String, sessionId: String): List<TranscriptItem>? {
        val payload = query("SELECT payload FROM transcripts WHERE desktop_key = ? AND session_id = ?", desktopKey, sessionId).firstOrNull()
        return payload?.let { runCatching { json.decodeFromString(transcriptSerializer, it) }.getOrNull() }
    }

    override fun saveTranscript(desktopKey: String, sessionId: String, items: List<TranscriptItem>) {
        if (query("SELECT session_id FROM sessions WHERE desktop_key = ? AND session_id = ?", desktopKey, sessionId).isEmpty()) return
        run(
            "INSERT OR REPLACE INTO transcripts (desktop_key, session_id, payload) VALUES (?, ?, ?)",
            desktopKey,
            sessionId,
            json.encodeToString(transcriptSerializer, items),
        )
    }

    override fun clearDesktop(desktopKey: String) {
        transaction {
            run("DELETE FROM sessions WHERE desktop_key = ?", desktopKey)
            run("DELETE FROM transcripts WHERE desktop_key = ?", desktopKey)
        }
    }

    fun close() {
        db?.close()
    }

    private fun transaction(block: () -> Unit) {
        val connection = db ?: return
        connection.execSQL("BEGIN")
        try {
            block()
            connection.execSQL("COMMIT")
        } catch (error: Throwable) {
            runCatching { connection.execSQL("ROLLBACK") }
            throw error
        }
    }

    private fun run(sql: String, vararg bindings: Any) {
        val connection = db ?: return
        connection.prepare(sql).use { statement ->
            bind(statement, bindings)
            statement.step()
        }
    }

    /** Returns the first column of every row as text. */
    private fun query(sql: String, vararg bindings: Any): List<String> {
        val connection = db ?: return emptyList()
        return connection.prepare(sql).use { statement ->
            bind(statement, bindings)
            buildList { while (statement.step()) add(statement.getText(0)) }
        }
    }

    private fun bind(statement: SQLiteStatement, bindings: Array<out Any>) {
        bindings.forEachIndexed { index, value ->
            when (value) {
                is String -> statement.bindText(index + 1, value)
                is Long -> statement.bindLong(index + 1, value)
                else -> error("unsupported binding ${value::class.simpleName}")
            }
        }
    }

    private companion object {
        val json = Json { ignoreUnknownKeys = true }
        val transcriptSerializer = ListSerializer(TranscriptItem.serializer())
    }
}
