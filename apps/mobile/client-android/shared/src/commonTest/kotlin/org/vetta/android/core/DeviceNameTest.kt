package org.vetta.android.core

import kotlin.test.Test
import kotlin.test.assertEquals

class DeviceNameTest {
    @Test
    fun theNameGivenInSettingsWins() {
        assertEquals("小明的手机", DeviceName.pick(" 小明的手机 ", "Xiaomi", "24031PN0DC"))
    }

    @Test
    fun otherwiseTheMakerComesBeforeTheModelOnce() {
        assertEquals("Xiaomi 24031PN0DC", DeviceName.pick(null, "xiaomi", "24031PN0DC"))
        assertEquals("Google Pixel 9 Pro", DeviceName.pick("", "Google", "Pixel 9 Pro"))
        assertEquals("samsung SM-S9180", DeviceName.pick(null, "samsung", "samsung SM-S9180"))
    }

    @Test
    fun fallsBackWhenTheSystemSaysNothing() {
        assertEquals("Android", DeviceName.pick(null, null, null))
        assertEquals("Google", DeviceName.pick(null, "Google", " "))
    }
}
