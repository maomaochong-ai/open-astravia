package org.vetta.android.domain.remote.pairing

import com.russhwolf.settings.MapSettings
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PairingStoreTest {
    @Test
    fun persistsSecretsApartAndRevokesCleanly() {
        val settings = MapSettings()
        val secrets = MapSettings()
        val store = PairingStore(settings, SettingsSecretStore(secrets)).apply { load() }
        val identity = store.getIdentity()
        assertFalse(store.hasCurrent)

        store.save(DesktopRecord("k1", "MacBook", "p1", "s1", listOf("a:1"), pairedAt = 1, lastSeenAt = 1))
        assertFalse(settings.getStringOrNull(PairingStore.DESKTOPS_KEY).orEmpty().contains("s1"), "the secret stays out of plain settings")
        assertEquals("s1", store.getCurrent()?.mobileSecret)
        store.update("k1") { it.copy(lastEventSequence = 7, lanEndpoints = listOf("b:2")) }

        val reloaded = PairingStore(settings, SettingsSecretStore(secrets)).apply { load() }
        assertContentEquals(identity.publicKey, reloaded.getIdentity().publicKey)
        assertEquals(7L, reloaded.getCurrent()?.lastEventSequence)
        assertEquals(listOf("b:2"), reloaded.getCurrent()?.lanEndpoints)

        reloaded.revoke("k1")
        assertFalse(reloaded.hasCurrent)
        assertNull(secrets.getStringOrNull(PairingStore.secretKey("k1")))
    }

    @Test
    fun adoptsALegacyIdentityOnlyWhenNoneIsStored() {
        val secrets = MapSettings()
        val legacy = "HyYtNDtCSVBXXmVsc3qBiI-WnaSrsrnAx87V3OPq8fg"
        val store = PairingStore(MapSettings(), SettingsSecretStore(secrets)).apply { load(legacyIdentitySecret = legacy) }
        assertEquals(legacy, secrets.getStringOrNull(PairingStore.IDENTITY_KEY))

        val other = PairingStore(MapSettings(), SettingsSecretStore(secrets)).apply { load(legacyIdentitySecret = "not-a-key") }
        assertContentEquals(store.getIdentity().publicKey, other.getIdentity().publicKey)
    }

    @Test
    fun aCorruptLegacyIdentityIsReplacedByAFreshOne() {
        val secrets = MapSettings()
        PairingStore(MapSettings(), SettingsSecretStore(secrets)).load(legacyIdentitySecret = "not-a-key")
        assertTrue(secrets.getStringOrNull(PairingStore.IDENTITY_KEY).orEmpty().length > 10)
    }
}
