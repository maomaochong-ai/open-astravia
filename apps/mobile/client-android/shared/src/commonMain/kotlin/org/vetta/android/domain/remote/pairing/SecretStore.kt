package org.vetta.android.domain.remote.pairing

import com.russhwolf.settings.Settings
import com.russhwolf.settings.set

/**
 * Where pairing secrets live: the phone's identity and each desktop's credential.
 * The app keeps them encrypted under a key the Android Keystore holds; tests and
 * previews use plain [Settings].
 */
interface SecretStore {
    fun get(key: String): String?

    fun set(key: String, value: String)

    fun remove(key: String)
}

class SettingsSecretStore(private val settings: Settings) : SecretStore {
    override fun get(key: String): String? = settings.getStringOrNull(key)

    override fun set(key: String, value: String) {
        settings[key] = value
    }

    override fun remove(key: String) {
        settings.remove(key)
    }
}
