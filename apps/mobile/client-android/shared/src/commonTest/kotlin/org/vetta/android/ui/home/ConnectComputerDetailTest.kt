package org.vetta.android.ui.home

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ConnectComputerDetailTest {
    @Test
    fun namesOnlyThePairedComputer() {
        assertEquals("MacBook Pro", connectComputerDetail(paired = true, desktopName = "MacBook Pro"))
        assertNull(connectComputerDetail(paired = false, desktopName = "MacBook Pro"))
        assertNull(connectComputerDetail(paired = true, desktopName = "   "))
        assertNull(connectComputerDetail(paired = true, desktopName = null))
    }
}
