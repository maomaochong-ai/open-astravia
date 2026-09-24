package org.vetta.android.domain.remote.connection

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import org.vetta.android.domain.remote.protocol.RemoteCrypto
import org.vetta.android.domain.remote.protocol.RemoteFrame
import org.vetta.android.domain.remote.protocol.RemoteHello
import org.vetta.android.domain.remote.protocol.RemoteHelloAck
import org.vetta.android.domain.remote.protocol.RemoteIdentityKeyPair
import org.vetta.android.domain.remote.protocol.RemoteRole
import org.vetta.android.domain.remote.protocol.RemoteSealed
import org.vetta.android.domain.remote.protocol.RemoteSessionFrame
import org.vetta.android.domain.remote.protocol.RemoteSessionKeys

class EncryptedDesktopTransport(
    private val onSessionFrame: suspend EncryptedDesktopTransport.(RemoteSessionFrame) -> Unit = {},
) : RemoteTransport {
    private val channel = Channel<RemoteFrame>(Channel.UNLIMITED)
    private val desktopIdentity = pair(DESKTOP_IDENTITY_SECRET)
    private val desktopEphemeral = pair(DESKTOP_EPHEMERAL_SECRET)
    private var keys: RemoteSessionKeys? = null

    override val incoming: Flow<RemoteFrame> = channel.receiveAsFlow()
    val receivedSessions = mutableListOf<RemoteSessionFrame>()

    val target: String =
        "wss://relay.example/v2/relay/pair-1234567890abcdef/mobile" +
            "#pairing=secret-1234567890abcdefghijklmnop" +
            "&identity=$MOBILE_IDENTITY_SECRET" +
            "&peer=${RemoteCrypto.toBase64Url(desktopIdentity.publicKey)}"

    override suspend fun connect() = Unit

    override suspend fun send(frame: RemoteFrame) {
        when (frame) {
            is RemoteHello -> {
                val mobileIdentity = RemoteCrypto.decodePublicKey(frame.identityKey)
                val mobileEphemeral = RemoteCrypto.decodePublicKey(frame.ephemeralKey)
                keys =
                    RemoteCrypto.deriveSessionKeys(
                        role = RemoteRole.Desktop,
                        identity = desktopIdentity,
                        ephemeral = desktopEphemeral,
                        peerIdentityKey = mobileIdentity,
                        peerEphemeralKey = mobileEphemeral,
                    )
                channel.send(
                    RemoteHelloAck(
                        connectionId = frame.connectionId,
                        peerDeviceId = "desktop-1",
                        peerIdentityKey = RemoteCrypto.toBase64Url(desktopIdentity.publicKey),
                        peerEphemeralKey = RemoteCrypto.toBase64Url(desktopEphemeral.publicKey),
                    ),
                )
            }
            is RemoteSealed -> {
                val session = RemoteCrypto.openFrame(requireNotNull(keys).receiveKey, frame)
                receivedSessions += session
                onSessionFrame(session)
            }
            else -> error("Protocol v2 client sent a plaintext ${frame::class.simpleName}")
        }
    }

    suspend fun sendSession(frame: RemoteSessionFrame) {
        channel.send(RemoteCrypto.sealFrame(requireNotNull(keys).sendKey, frame))
    }

    fun disconnect() {
        channel.close()
    }

    override suspend fun close() {
        channel.close()
    }

    private fun pair(secret: String): RemoteIdentityKeyPair =
        RemoteCrypto.identityKeyPairFromSecret(RemoteCrypto.fromBase64Url(secret))

    private companion object {
        const val MOBILE_IDENTITY_SECRET = "HyYtNDtCSVBXXmVsc3qBiI-WnaSrsrnAx87V3OPq8fg"
        const val DESKTOP_IDENTITY_SECRET = "XWRrcnmAh46VnKOqsbi_xs3U2-Lp8Pf-BQwTGiEoLzY"
        const val DESKTOP_EPHEMERAL_SECRET = "fIOKkZifpq20u8LJ0Nfe5ezz-gEIDxYdJCsyOUBHTlU"
    }
}
