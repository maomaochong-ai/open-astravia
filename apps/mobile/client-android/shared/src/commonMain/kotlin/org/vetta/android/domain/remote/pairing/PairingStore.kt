package org.vetta.android.domain.remote.pairing

import com.russhwolf.settings.Settings
import com.russhwolf.settings.set
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import org.vetta.android.domain.remote.protocol.RemoteCrypto
import org.vetta.android.domain.remote.protocol.RemoteIdentityKeyPair

/** One paired desktop as the phone knows it. The secret lives in the secret store. */
data class DesktopRecord(
    /** base64url X25519 identity key of the desktop; primary key. */
    val desktopIdentityKey: String,
    val desktopName: String,
    val pairingId: String,
    val mobileSecret: String,
    val lanEndpoints: List<String>,
    val relayBaseUrl: String? = null,
    val lastEventSequence: Long = 0,
    val pairedAt: Long = 0,
    val lastSeenAt: Long = 0,
) {
    val stored: StoredDesktop
        get() = StoredDesktop(desktopIdentityKey, desktopName, pairingId, lanEndpoints, relayBaseUrl, lastEventSequence, pairedAt, lastSeenAt)

    override fun toString(): String = "DesktopRecord(desktopName=$desktopName, pairingId=$pairingId)"
}

/** A desktop record without its secret: what is persisted in plain settings and shown in the UI. */
@Serializable
data class StoredDesktop(
    val desktopIdentityKey: String,
    val desktopName: String,
    val pairingId: String,
    val lanEndpoints: List<String> = emptyList(),
    val relayBaseUrl: String? = null,
    val lastEventSequence: Long = 0,
    val pairedAt: Long = 0,
    val lastSeenAt: Long = 0,
) {
    fun withSecret(secret: String): DesktopRecord =
        DesktopRecord(desktopIdentityKey, desktopName, pairingId, secret, lanEndpoints, relayBaseUrl, lastEventSequence, pairedAt, lastSeenAt)
}

/**
 * Persists the phone's identity and every paired desktop (port of the iOS
 * `PairingStore.swift`). Only one desktop is "current", but records for several
 * are kept so a later multi-computer UI needs no migration. Secrets (identity
 * and per-desktop credential) go to [secrets]; everything else to [settings].
 */
class PairingStore(
    private val settings: Settings,
    private val secrets: Settings,
) {
    private var identity: RemoteIdentityKeyPair? = null
    private var current: String? = null

    var desktops: List<StoredDesktop> = emptyList()
        private set

    /**
     * @param legacyIdentitySecret the identity an earlier build kept elsewhere; adopted
     * when there is none yet so desktops that pinned it keep recognising this phone.
     */
    fun load(legacyIdentitySecret: String? = null) {
        identity =
            (secrets.getStringOrNull(IDENTITY_KEY) ?: legacyIdentitySecret)
                ?.let { secret ->
                    runCatching { RemoteCrypto.identityKeyPairFromSecret(RemoteCrypto.fromBase64Url(secret)) }
                        .getOrNull()
                        ?.also { secrets[IDENTITY_KEY] = secret }
                }
                ?: RemoteCrypto.generateIdentityKeyPair().also {
                    secrets[IDENTITY_KEY] = RemoteCrypto.toBase64Url(it.secretKey)
                }
        desktops = settings.getStringOrNull(DESKTOPS_KEY)?.let(::parseDesktops).orEmpty()
        current = settings.getStringOrNull(CURRENT_KEY) ?: desktops.firstOrNull()?.desktopIdentityKey
    }

    fun getIdentity(): RemoteIdentityKeyPair = checkNotNull(identity) { "pairing store is not loaded" }

    fun getCurrent(): DesktopRecord? {
        val stored = desktops.firstOrNull { it.desktopIdentityKey == current } ?: return null
        val secret = secrets.getStringOrNull(secretKey(stored.desktopIdentityKey)) ?: return null
        return stored.withSecret(secret)
    }

    val hasCurrent: Boolean
        get() = desktops.any { it.desktopIdentityKey == current }

    fun save(record: DesktopRecord) {
        secrets[secretKey(record.desktopIdentityKey)] = record.mobileSecret
        desktops = listOf(record.stored) + desktops.filterNot { it.desktopIdentityKey == record.desktopIdentityKey }
        current = record.desktopIdentityKey
        persist()
    }

    fun update(desktopIdentityKey: String, patch: (StoredDesktop) -> StoredDesktop) {
        val index = desktops.indexOfFirst { it.desktopIdentityKey == desktopIdentityKey }
        if (index < 0) return
        desktops = desktops.toMutableList().also { it[index] = patch(it[index]) }
        persist()
    }

    fun revoke(desktopIdentityKey: String) {
        desktops = desktops.filterNot { it.desktopIdentityKey == desktopIdentityKey }
        secrets.remove(secretKey(desktopIdentityKey))
        if (current == desktopIdentityKey) current = desktops.firstOrNull()?.desktopIdentityKey
        persist()
    }

    private fun persist() {
        settings[DESKTOPS_KEY] = json.encodeToString(ListSerializer(StoredDesktop.serializer()), desktops)
        val key = current
        if (key != null) settings[CURRENT_KEY] = key else settings.remove(CURRENT_KEY)
    }

    private fun parseDesktops(raw: String): List<StoredDesktop> =
        runCatching { json.decodeFromString(ListSerializer(StoredDesktop.serializer()), raw) }.getOrDefault(emptyList())

    companion object {
        const val IDENTITY_KEY = "vetta.identity.secret"
        const val DESKTOPS_KEY = "vetta.desktops"
        const val CURRENT_KEY = "vetta.desktops.current"

        fun secretKey(desktopIdentityKey: String): String = "vetta.desktop.$desktopIdentityKey.secret"

        private val json = Json { ignoreUnknownKeys = true }
    }
}
