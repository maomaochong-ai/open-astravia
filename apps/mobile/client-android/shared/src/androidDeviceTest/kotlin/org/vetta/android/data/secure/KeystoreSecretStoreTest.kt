package org.vetta.android.data.secure

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.runner.RunWith
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

@RunWith(AndroidJUnit4::class)
class KeystoreSecretStoreTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val key = "test.secret"

    @AfterTest
    fun cleanUp() {
        KeystoreSecretStore(context).remove(key)
    }

    @Test
    fun keepsASecretEncryptedAcrossInstancesAndForgetsItOnRemove() {
        KeystoreSecretStore(context).set(key, "secret-1234567890abcdef")
        assertEquals("secret-1234567890abcdef", KeystoreSecretStore(context).get(key))

        val stored = context.getSharedPreferences("vetta.secrets", Context.MODE_PRIVATE).getString(key, null).orEmpty()
        assertFalse("secret-1234567890abcdef" in stored, "only ciphertext reaches the preferences file")

        KeystoreSecretStore(context).remove(key)
        assertNull(KeystoreSecretStore(context).get(key))
    }

    @Test
    fun aValueThatNoLongerDecryptsReadsAsMissing() {
        context.getSharedPreferences("vetta.secrets", Context.MODE_PRIVATE).edit().putString(key, "bm90LWVuY3J5cHRlZA==").commit()
        assertNull(KeystoreSecretStore(context).get(key))
    }
}
