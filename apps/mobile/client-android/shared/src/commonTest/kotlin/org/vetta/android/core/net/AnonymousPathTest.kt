package org.vetta.android.core.net

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AnonymousPathTest {
    @Test
    fun marksAuthEndpointsAnonymous() {
        assertTrue(isAnonymousAuthPath("/api/v1/auth/login"))
        assertTrue(isAnonymousAuthPath("/api/v1/auth/refresh"))
        assertTrue(isAnonymousAuthPath("auth/email/password/login"))
        assertFalse(isAnonymousAuthPath("/api/v1/users/me"))
        assertFalse(isAnonymousAuthPath("/api/v1/auth/email/password"))
    }
}
