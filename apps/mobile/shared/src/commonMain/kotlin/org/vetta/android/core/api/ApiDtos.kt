package org.vetta.android.core.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
internal data class ApiEnvelope<T>(
    val code: Int = 0,
    val message: String = "",
    val data: T? = null,
)

@Serializable
internal data class LoginRequestDto(
    val account: String,
    val password: String,
)

@Serializable
internal data class EmailPasswordLoginRequestDto(
    val email: String,
    val password: String,
)

@Serializable
internal data class SmsLoginRequestDto(
    val phone: String,
    val code: String,
)

@Serializable
internal data class SendSmsCodeRequestDto(
    val phone: String,
)

@Serializable
internal data class RefreshTokenRequestDto(
    @SerialName("refresh_token")
    val refreshToken: String,
)

@Serializable
internal data class LogoutRequestDto(
    @SerialName("refresh_token")
    val refreshToken: String? = null,
)

@Serializable
internal data class LoginResponseDto(
    val token: String? = null,
    @SerialName("access_token")
    val accessToken: String? = null,
    @SerialName("refresh_token")
    val refreshToken: String? = null,
    @SerialName("requires_password")
    val requiresPassword: Boolean = false,
    val user: UserDto,
)

@Serializable
internal data class RefreshResponseDto(
    @SerialName("access_token")
    val accessToken: String,
    @SerialName("refresh_token")
    val refreshToken: String,
)

@Serializable
internal data class UserDto(
    val id: Long,
    val username: String,
    val nickname: String = "",
    val phone: String? = null,
    val email: String? = null,
    val avatar: String = "",
    @SerialName("is_active")
    val isActive: Boolean = true,
    @SerialName("created_at")
    val createdAt: String? = null,
)

@Serializable
internal data class SubscriptionStatusDto(
    val active: Boolean = false,
    @SerialName("is_default")
    val isDefault: Boolean = false,
    @SerialName("go_enabled")
    val goEnabled: Boolean = false,
    @SerialName("tier_id")
    val tierId: Long? = null,
    @SerialName("tier_name")
    val tierName: String? = null,
    @SerialName("badge_text")
    val badgeText: String? = null,
    @SerialName("badge_color")
    val badgeColor: String? = null,
    val description: String? = null,
    @SerialName("expires_at")
    val expiresAt: String? = null,
    val windows: List<QuotaWindowDto> = emptyList(),
)

@Serializable
internal data class QuotaWindowDto(
    val kind: String,
    val limit: Double = 0.0,
    val consumed: Double = 0.0,
    @SerialName("reset_at")
    val resetAt: String? = null,
)

@Serializable
internal data class ModelsCatalogDto(
    val providers: Map<String, ProviderConfigDto> = emptyMap(),
)

@Serializable
internal data class ProviderConfigDto(
    val api: String? = null,
    val baseUrl: String? = null,
    val models: List<RemoteModelDto> = emptyList(),
)

@Serializable
internal data class RemoteModelDto(
    val id: String,
    val modelId: String? = null,
    val name: String? = null,
    val api: String? = null,
    val reasoning: Boolean = false,
    val input: List<String> = emptyList(),
    val contextWindow: Long? = null,
    val maxTokens: Long? = null,
    val multiplier: Double? = null,
    val tags: List<String> = emptyList(),
    val reasoningLevels: List<String> = emptyList(),
    val defaultReasoningLevel: String? = null,
    val upstreamBaseUrl: String? = null,
)

@Serializable
internal data class ChatCompletionRequestDto(
    val model: String,
    val messages: List<ChatMessageDto>,
    val stream: Boolean = true,
    val temperature: Double? = null,
)

@Serializable
internal data class ChatMessageDto(
    val role: String,
    /** OpenAI 兼容：纯字符串，或 text/image_url 数组。 */
    val content: kotlinx.serialization.json.JsonElement,
)

@Serializable
internal data class OpenAiErrorBody(
    val error: OpenAiErrorDetail? = null,
    val message: String? = null,
)

@Serializable
internal data class OpenAiErrorDetail(
    val message: String? = null,
    val type: String? = null,
    val code: Int? = null,
)

@Serializable
internal data class ChatCompletionChunkDto(
    val id: String? = null,
    val choices: List<ChatChoiceDto> = emptyList(),
    val usage: ChatUsageDto? = null,
)

@Serializable
internal data class ChatChoiceDto(
    val index: Int = 0,
    val delta: ChatDeltaDto? = null,
    val message: ChatMessageDto? = null,
    @SerialName("finish_reason")
    val finishReason: String? = null,
)

@Serializable
internal data class ChatDeltaDto(
    val role: String? = null,
    val content: String? = null,
)

@Serializable
internal data class ChatUsageDto(
    @SerialName("prompt_tokens")
    val promptTokens: Int? = null,
    @SerialName("completion_tokens")
    val completionTokens: Int? = null,
    @SerialName("total_tokens")
    val totalTokens: Int? = null,
)
