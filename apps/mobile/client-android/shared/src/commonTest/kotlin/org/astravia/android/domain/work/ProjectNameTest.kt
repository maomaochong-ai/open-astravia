package org.astravia.android.domain.work

import org.astravia.android.domain.remote.RemoteProjectSummary
import org.astravia.android.domain.remote.RemoteSessionStatus
import org.astravia.android.domain.remote.RemoteSessionSummary
import kotlin.test.Test
import kotlin.test.assertEquals

class ProjectNameTest {
    @Test
    fun namesAProjectByTheDesktopThenBySessionsThenByItsFolder() {
        val state =
            MirrorState(
                projects = listOf(RemoteProjectSummary("/code/astravia", "Astravia", "project", 3)),
                sessions = listOf(RemoteSessionSummary("s1", "/code/api", "API 服务", "t", null, 1, RemoteSessionStatus.Idle, false)),
            )
        assertEquals("Astravia", state.projectName("/code/astravia"))
        assertEquals("API 服务", state.projectName("/code/api"))
        assertEquals("tools", state.projectName("C:\\work\\tools\\"))
    }
}
