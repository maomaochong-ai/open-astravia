package org.vetta.android.domain.remote.connection

import kotlinx.coroutines.flow.Flow
import org.vetta.android.domain.remote.protocol.RemoteFrame

interface RemoteTransport {
    val incoming: Flow<RemoteFrame>

    /**
     * Why the other side closed the socket, once `incoming` has ended. The
     * desktop explains a declined or unknown pairing only this way.
     */
    val closeReason: String?
        get() = null

    suspend fun connect()

    suspend fun send(frame: RemoteFrame)

    suspend fun close()
}

interface RemoteLogger {
    fun debug(message: String, fields: Map<String, Any?> = emptyMap())

    fun info(message: String, fields: Map<String, Any?> = emptyMap())

    fun warn(message: String, fields: Map<String, Any?> = emptyMap())
}

object NoopRemoteLogger : RemoteLogger {
    override fun debug(message: String, fields: Map<String, Any?>) = Unit

    override fun info(message: String, fields: Map<String, Any?>) = Unit

    override fun warn(message: String, fields: Map<String, Any?>) = Unit
}

expect object PlatformRemoteLogger : RemoteLogger
