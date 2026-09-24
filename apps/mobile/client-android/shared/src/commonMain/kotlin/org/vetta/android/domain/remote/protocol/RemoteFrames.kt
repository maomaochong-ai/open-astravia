package org.vetta.android.domain.remote.protocol

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

const val REMOTE_PROTOCOL_VERSION = 2

@Serializable
enum class RemoteRole {
    @SerialName("mobile")
    Mobile,

    @SerialName("desktop")
    Desktop,
}

@Serializable
data class RemoteCapabilities(
    val chat: Boolean,
    val sessionRead: Boolean,
    val fileRead: Boolean? = null,
    val fileWrite: Boolean? = null,
    val terminal: Boolean? = null,
    val screen: Boolean? = null,
    val input: Boolean? = null,
)

@Serializable
sealed interface RemoteFrame

sealed interface RemoteSessionFrame : RemoteFrame

@Serializable
@SerialName("hello")
data class RemoteHello(
    val protocolVersion: Int = REMOTE_PROTOCOL_VERSION,
    val role: RemoteRole,
    val deviceId: String,
    val deviceName: String,
    val capabilities: RemoteCapabilities,
    val connectionId: String,
    val identityKey: String,
    val ephemeralKey: String,
) : RemoteFrame

@Serializable
@SerialName("hello_ack")
data class RemoteHelloAck(
    val protocolVersion: Int = REMOTE_PROTOCOL_VERSION,
    val connectionId: String,
    val peerDeviceId: String,
    val peerIdentityKey: String,
    val peerEphemeralKey: String,
) : RemoteFrame

@Serializable
@SerialName("pairing_pending")
data class RemotePairingPending(
    val connectionId: String,
    val peerDeviceId: String,
    val peerIdentityKey: String,
) : RemoteFrame

@Serializable
@SerialName("peer_status")
data class RemotePeerStatus(val online: Boolean) : RemoteFrame

@Serializable
@SerialName("sealed")
data class RemoteSealed(
    val nonce: String,
    val ciphertext: String,
) : RemoteFrame

@Serializable
enum class RemoteRequestMethod {
    @SerialName("project.list") ProjectList,
    @SerialName("session.list") SessionList,
    @SerialName("session.create") SessionCreate,
    @SerialName("session.open") SessionOpen,
    @SerialName("session.history") SessionHistory,
    @SerialName("session.prompt") SessionPrompt,
    @SerialName("session.upload") SessionUpload,
    @SerialName("model.list") ModelList,
    @SerialName("session.configure") SessionConfigure,
    @SerialName("session.rename") SessionRename,
    @SerialName("session.pin") SessionPin,
    @SerialName("session.delete") SessionDelete,
    @SerialName("session.respond") SessionRespond,
    @SerialName("session.abort") SessionAbort,
    @SerialName("session.resume") SessionResume,
    @SerialName("diagnostics.snapshot") DiagnosticsSnapshot,
}

@Serializable
@SerialName("request")
data class RemoteRequest(
    val requestId: String,
    val method: RemoteRequestMethod,
    val sessionId: String? = null,
    val payload: JsonElement? = null,
) : RemoteSessionFrame

@Serializable
@SerialName("response")
data class RemoteResponse(
    val requestId: String,
    val success: Boolean,
    val payload: JsonElement? = null,
    val error: RemoteError? = null,
) : RemoteSessionFrame

@Serializable
enum class RemoteEventName {
    @SerialName("device.status") DeviceStatus,
    @SerialName("device.paired") DevicePaired,
    @SerialName("session.list") SessionList,
    @SerialName("session.state") SessionState,
    @SerialName("session.message") SessionMessage,
    @SerialName("session.tool") SessionTool,
    @SerialName("session.input") SessionInput,
    @SerialName("session.resync") SessionResync,
    @SerialName("diagnostics.updated") DiagnosticsUpdated,
}

@Serializable
@SerialName("event")
data class RemoteEvent(
    val eventId: String,
    val sequence: Long,
    val name: RemoteEventName,
    val sessionId: String? = null,
    val payload: JsonElement? = null,
) : RemoteSessionFrame

@Serializable
@SerialName("ack")
data class RemoteAck(val sequence: Long) : RemoteSessionFrame

@Serializable
@SerialName("resume")
data class RemoteResume(val lastEventSequence: Long) : RemoteSessionFrame

@Serializable
enum class RemoteErrorCode {
    @SerialName("invalid_frame") InvalidFrame,
    @SerialName("unsupported_version") UnsupportedVersion,
    @SerialName("unauthorized") Unauthorized,
    @SerialName("approval_rejected") ApprovalRejected,
    @SerialName("not_found") NotFound,
    @SerialName("busy") Busy,
    @SerialName("request_timeout") RequestTimeout,
    @SerialName("transport_closed") TransportClosed,
    @SerialName("internal_error") InternalError,
}

@Serializable
data class RemoteError(
    val code: RemoteErrorCode,
    val message: String,
    val retryable: Boolean,
)
