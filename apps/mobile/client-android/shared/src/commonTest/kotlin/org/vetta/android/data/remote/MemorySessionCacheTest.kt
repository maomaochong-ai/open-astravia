package org.vetta.android.data.remote

import kotlin.test.Test

class MemorySessionCacheTest {
    @Test
    fun keepsTheMostRecentAndDropsTranscripts() {
        SessionCacheContract.exercise(MemorySessionCache())
    }
}
