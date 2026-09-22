package org.vetta.android.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class VettaConfigTest {
    @Test
    fun stripsApiV1ForGateway() {
        val config = VettaConfig("http://example.com:8080/api/v1")
        assertEquals("http://example.com:8080/api/v1", config.apiBaseUrl)
        assertEquals("http://example.com:8080/gateway", config.gatewayBaseUrl)
    }

    @Test
    fun trimsTrailingSlash() {
        val config = VettaConfig("http://example.com/api/v1/")
        assertEquals("http://example.com/api/v1", config.apiBaseUrl)
        assertEquals("http://example.com/gateway", config.gatewayBaseUrl)
    }

    @Test
    fun rejectsBlank() {
        assertFailsWith<IllegalArgumentException> {
            VettaConfig("  ")
        }
    }
}
