package org.vetta.android.data.remote

import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.RemoteSessionSummary
import org.vetta.android.domain.remote.TranscriptItem
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** What every [SessionCache] must do; each implementation's test runs it. */
object SessionCacheContract {
    fun session(id: Int) = RemoteSessionSummary("s$id", "/conv", "对话", "会话 $id", null, id.toLong(), RemoteSessionStatus.Idle, false)

    fun exercise(cache: SessionCache) {
        val sessions = (1..60).map(::session)
        cache.saveSessions("d1", sessions.take(10))
        cache.saveTranscript("d1", "s1", listOf(TranscriptItem.User("u", "hi", null)))
        assertEquals(1, cache.loadTranscript("d1", "s1")?.size)

        cache.saveSessions("d1", sessions)
        val kept = cache.loadSessions("d1")
        assertEquals(SessionCacheLimit.SESSIONS, kept.size)
        assertEquals("s60", kept.first().id)
        assertFalse(kept.any { it.id == "s1" })
        assertNull(cache.loadTranscript("d1", "s1"), "an evicted session takes its transcript with it")

        cache.saveTranscript("d1", "ghost", emptyList())
        assertNull(cache.loadTranscript("d1", "ghost"), "no transcript without its session")

        cache.saveSessions("d2", listOf(session(2)))
        cache.clearDesktop("d1")
        assertTrue(cache.loadSessions("d1").isEmpty())
        assertEquals(1, cache.loadSessions("d2").size)
    }
}
