package org.vetta.android.domain.work

import org.vetta.android.domain.remote.RemoteProjectSummary
import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.RemoteSessionSummary
import kotlin.test.Test
import kotlin.test.assertEquals

class ProjectNameTest {
    @Test
    fun namesAProjectByTheDesktopThenBySessionsThenByItsFolder() {
        val state =
            MirrorState(
                projects = listOf(RemoteProjectSummary("/code/vetta", "Vetta", "project", 3)),
                sessions = listOf(RemoteSessionSummary("s1", "/code/api", "API 服务", "t", null, 1, RemoteSessionStatus.Idle, false)),
            )
        assertEquals("Vetta", state.projectName("/code/vetta"))
        assertEquals("API 服务", state.projectName("/code/api"))
        assertEquals("tools", state.projectName("C:\\work\\tools\\"))
    }
}
