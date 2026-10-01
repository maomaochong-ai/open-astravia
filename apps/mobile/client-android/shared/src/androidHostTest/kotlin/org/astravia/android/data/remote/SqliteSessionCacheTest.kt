package org.astravia.android.data.remote

import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import org.astravia.android.domain.remote.AssistantTurn
import org.astravia.android.domain.remote.ToolCard
import org.astravia.android.domain.remote.ToolCardStatus
import org.astravia.android.domain.remote.TranscriptItem
import java.io.File
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals

class SqliteSessionCacheTest {
    private val file = File.createTempFile("astravia-cache", ".sqlite").also { it.delete() }

    @AfterTest
    fun cleanUp() {
        file.delete()
    }

    @Test
    fun behavesLikeTheMemoryCacheAndSurvivesReopening() {
        SqliteSessionCache(BundledSQLiteDriver(), file.path).also(SessionCacheContract::exercise).close()

        val turn = AssistantTurn("a", "**hi**", "", listOf(ToolCard("t", "bash", ToolCardStatus.Done)), streaming = false, at = 3)
        SqliteSessionCache(BundledSQLiteDriver(), file.path).apply {
            saveTranscript("d2", "s2", listOf(TranscriptItem.Assistant(turn)))
            close()
        }
        val reopened = SqliteSessionCache(BundledSQLiteDriver(), file.path)
        assertEquals("会话 2", reopened.loadSessions("d2").first().title)
        assertEquals(listOf<TranscriptItem>(TranscriptItem.Assistant(turn)), reopened.loadTranscript("d2", "s2"))
        reopened.close()
    }

    @Test
    fun aDatabaseThatCannotOpenLeavesTheCacheEmpty() {
        val cache = SqliteSessionCache(BundledSQLiteDriver(), File(file.parentFile, "missing-dir/x/cache.sqlite").path)
        cache.saveSessions("d1", listOf(SessionCacheContract.session(1)))
        assertEquals(emptyList(), cache.loadSessions("d1"))
    }
}
