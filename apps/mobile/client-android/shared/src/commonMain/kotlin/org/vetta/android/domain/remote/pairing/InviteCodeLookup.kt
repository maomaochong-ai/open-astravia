package org.vetta.android.domain.remote.pairing

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.vetta.android.core.net.platformHttpClientEngine
import org.vetta.android.domain.remote.protocol.InviteCode
import org.vetta.android.domain.remote.protocol.RemoteProtocolException

/** What a connection code and password led to. */
sealed interface InviteLookup {
    /** The pairing link, the same one the QR code carries. */
    data class Found(val uri: String) : InviteLookup

    /** No invite under this code: mistyped, already used, or expired. */
    data object NotFound : InviteLookup

    data object WrongPassword : InviteLookup

    /** The relay could not be reached or did not answer as one. */
    data object Unreachable : InviteLookup
}

/**
 * Fetches the invite a desktop left on the relay under a connection code and opens it
 * with the password (ADR-0136). `get` returns the HTTP status and body, or null when the
 * relay could not be reached; tests pass their own.
 */
class InviteCodeLookup(
    private val get: suspend (url: String) -> Pair<Int, String>? = ::httpGet,
) {
    suspend fun lookup(code: String, password: String, relayBaseUrl: String = InviteCode.DEFAULT_RELAY_BASE_URL): InviteLookup {
        val normalized = InviteCode.normalize(code) ?: return InviteLookup.NotFound
        if (!InviteCode.isValidPassword(password)) return InviteLookup.WrongPassword
        val reply = get(InviteCode.boxUrl(relayBaseUrl, normalized)) ?: return InviteLookup.Unreachable
        return when (reply.first) {
            200 -> {
                val envelope = readEnvelope(reply.second) ?: return InviteLookup.Unreachable
                // The key is stretched on purpose (200 000 rounds); keep it off the main thread.
                withContext(Dispatchers.Default) {
                    try {
                        InviteLookup.Found(InviteCode.open(envelope, normalized, password))
                    } catch (_: RemoteProtocolException) {
                        InviteLookup.WrongPassword
                    }
                }
            }
            404 -> InviteLookup.NotFound
            else -> InviteLookup.Unreachable
        }
    }

    private fun readEnvelope(body: String): InviteCode.Envelope? {
        val envelope = runCatching { Json.parseToJsonElement(body) }.getOrNull()?.let { it as? JsonObject }?.get("envelope") as? JsonObject ?: return null
        val nonce = (envelope["nonce"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        val ciphertext = (envelope["ciphertext"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        return InviteCode.Envelope(nonce, ciphertext)
    }

    private companion object {
        val client by lazy { HttpClient(platformHttpClientEngine()) { expectSuccess = false } }

        suspend fun httpGet(url: String): Pair<Int, String>? =
            try {
                val response = client.get(url)
                response.status.value to response.bodyAsText()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Throwable) {
                null
            }
    }
}
