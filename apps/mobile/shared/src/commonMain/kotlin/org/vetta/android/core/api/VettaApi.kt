package org.vetta.android.core.api

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import io.ktor.utils.io.readUTF8Line
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.vetta.android.core.VettaConfig
import org.vetta.android.core.auth.TokenStore
import org.vetta.android.core.chat.ChatRequestEncoder
import org.vetta.android.core.chat.OpenAiSseParser
import org.vetta.android.core.error.VettaException
import org.vetta.android.core.model.AuthSession
import org.vetta.android.core.model.ChatMessage
import org.vetta.android.core.model.ChatStreamEvent
import org.vetta.android.core.model.ModelsCatalog
import org.vetta.android.core.model.SubscriptionStatus
import org.vetta.android.core.model.User
import org.vetta.android.core.net.RefreshOutcome
import org.vetta.android.core.net.VettaJson
import org.vetta.android.core.net.parseEnvelope
import org.vetta.android.core.net.parseFailure
import org.vetta.android.core.net.toVettaException

/**
 * 对 Vetta API / Gateway 的薄封装。路径与 desktop 客户端对齐：
 * - REST：相对 [VettaConfig.apiBaseUrl]（含 `/api/v1`）
 * - Chat：`{gatewayBaseUrl}/v1/chat/completions`
 */
internal class VettaApi(
    private val client: HttpClient,
    private val bareClient: HttpClient,
    private val config: VettaConfig,
    private val tokenStore: TokenStore,
) {
    suspend fun loginWithAccount(account: String, password: String): AuthSession =
        postAuth("auth/login", LoginRequestDto(account = account, password = password))

    suspend fun loginWithEmailPassword(email: String, password: String): AuthSession =
        postAuth(
            "auth/email/password/login",
            EmailPasswordLoginRequestDto(email = email, password = password),
        )

    suspend fun loginWithSms(phone: String, code: String): AuthSession =
        postAuth("auth/sms/login", SmsLoginRequestDto(phone = phone, code = code))

    suspend fun sendSmsCode(phone: String) {
        try {
            val response =
                client.post("auth/sms/send") {
                    setBody(SendSmsCodeRequestDto(phone = phone))
                }
            val text = response.bodyAsTextSafe()
            if (!response.status.isSuccess()) {
                throw parseFailure(response.status.value, text)
            }
            ensureBusinessSuccess(response.status.value, text)
        } catch (e: Exception) {
            throw e.toVettaException()
        }
    }

    suspend fun refreshTokens(refreshToken: String): RefreshOutcome {
        return try {
            val response =
                bareClient.post("auth/refresh") {
                    setBody(RefreshTokenRequestDto(refreshToken = refreshToken))
                }
            if (response.status.value == 401) {
                return RefreshOutcome.Unauthorized
            }
            if (!response.status.isSuccess()) {
                return RefreshOutcome.Transient
            }
            val pair =
                runCatching {
                    response.parseEnvelope<RefreshResponseDto>().toTokenPair()
                }.getOrElse {
                    return RefreshOutcome.Transient
                }
            RefreshOutcome.Ok(pair.accessToken, pair.refreshToken)
        } catch (_: Exception) {
            RefreshOutcome.Transient
        }
    }

    suspend fun logout() {
        val refresh = tokenStore.refreshToken
        try {
            client.post("auth/logout") {
                setBody(LogoutRequestDto(refreshToken = refresh))
            }
        } catch (_: Exception) {
            // logout 幂等：网络失败忽略，本地仍清 token
        }
    }

    suspend fun me(): User =
        try {
            client.get("users/me").parseEnvelope<UserDto>().toDomain()
        } catch (e: Exception) {
            throw e.toVettaException()
        }

    suspend fun subscriptionMe(): SubscriptionStatus =
        try {
            client.get("subscription/me").parseEnvelope<SubscriptionStatusDto>().toDomain()
        } catch (e: Exception) {
            throw e.toVettaException()
        }

    suspend fun goModels(): ModelsCatalog =
        try {
            client.get("providers/go-models.json").parseEnvelope<ModelsCatalogDto>().toDomain()
        } catch (e: Exception) {
            throw e.toVettaException()
        }

    fun streamChat(
        model: String,
        messages: List<ChatMessage>,
        temperature: Double? = null,
    ): Flow<ChatStreamEvent> =
        flow {
            val wireMessages = ChatRequestEncoder.encodeMessages(messages)
            val body =
                ChatCompletionRequestDto(
                    model = model,
                    messages =
                        wireMessages.map { obj ->
                            ChatMessageDto(
                                role = (obj["role"] as kotlinx.serialization.json.JsonPrimitive).content,
                                content = obj["content"]!!,
                            )
                        },
                    stream = true,
                    temperature = temperature,
                )
            val url = config.gatewayBaseUrl.trimEnd('/') + "/v1/chat/completions"
            try {
                val response =
                    client.post(url) {
                        setBody(body)
                        headers.append(HttpHeaders.Accept, "text/event-stream")
                    }
                if (!response.status.isSuccess()) {
                    val text = response.bodyAsTextSafe()
                    emit(ChatStreamEvent.Error(parseFailure(response.status.value, text)))
                    return@flow
                }

                val channel = response.bodyAsChannel()
                var sawDone = false
                while (!channel.isClosedForRead) {
                    val line = channel.readUTF8Line() ?: break
                    val event = OpenAiSseParser.parseLine(line) ?: continue
                    if (event is ChatStreamEvent.Done) {
                        sawDone = true
                    }
                    emit(event)
                    if (event is ChatStreamEvent.Error) {
                        return@flow
                    }
                }
                if (!sawDone) {
                    emit(ChatStreamEvent.Done)
                }
            } catch (e: Exception) {
                emit(ChatStreamEvent.Error(e.toVettaException()))
            }
        }

    private suspend fun postAuth(path: String, body: Any): AuthSession =
        try {
            val response =
                client.post(path) {
                    setBody(body)
                }
            val session = response.parseEnvelope<LoginResponseDto>().toSession()
            tokenStore.save(session.accessToken, session.refreshToken)
            session
        } catch (e: Exception) {
            throw e.toVettaException()
        }
}

private suspend fun HttpResponse.bodyAsTextSafe(): String =
    runCatching { bodyAsText() }.getOrDefault("")

private fun ensureBusinessSuccess(httpStatus: Int, body: String) {
    val obj = runCatching { VettaJson.parseToJsonElement(body) as? JsonObject }.getOrNull() ?: return
    val code = (obj["code"] as? JsonPrimitive)?.content?.toIntOrNull() ?: return
    val message = (obj["message"] as? JsonPrimitive)?.content.orEmpty()
    if (code == 0) return
    if (httpStatus == 401 || code in org.vetta.android.core.net.UNAUTHORIZED_CODES) {
        throw VettaException.Unauthorized(message.ifBlank { "未授权" }, code)
    }
    throw VettaException.Api(
        httpStatus = httpStatus,
        code = code,
        message = message.ifBlank { "请求失败" },
        rawBody = body,
    )
}
