package org.vetta.android.core.net

import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.isSuccess
import kotlinx.serialization.serializer
import org.vetta.android.core.api.ApiEnvelope
import org.vetta.android.core.api.OpenAiErrorBody
import org.vetta.android.core.error.VettaException

internal suspend inline fun <reified T> HttpResponse.parseEnvelope(): T {
    val text = bodyAsText()
    if (!status.isSuccess()) {
        throw parseFailure(status.value, text)
    }
    val envelope =
        runCatching {
            VettaJson.decodeFromString(ApiEnvelope.serializer(serializer<T>()), text)
        }.getOrElse { cause ->
            throw VettaException.Protocol("无法解析 API 响应", cause)
        }
    if (envelope.code != 0) {
        if (status.value == 401 || envelope.code in UNAUTHORIZED_CODES) {
            throw VettaException.Unauthorized(envelope.message, envelope.code)
        }
        throw VettaException.Api(
            httpStatus = status.value,
            code = envelope.code,
            message = envelope.message.ifBlank { "请求失败" },
            rawBody = text,
        )
    }
    val data = envelope.data
    if (data == null) {
        if (null is T) {
            @Suppress("UNCHECKED_CAST")
            return null as T
        }
        throw VettaException.Protocol("API 响应 data 为空")
    }
    return data
}

internal suspend fun HttpResponse.ensureSuccessOrThrow() {
    if (status.isSuccess()) return
    throw parseFailure(status.value, bodyAsText())
}

internal fun parseFailure(httpStatus: Int, body: String): VettaException {
    // 优先业务信封（忽略 data 形状）
    runCatching {
        val element = VettaJson.parseToJsonElement(body)
        val obj = element as? kotlinx.serialization.json.JsonObject
        val code = (obj?.get("code") as? kotlinx.serialization.json.JsonPrimitive)?.content?.toIntOrNull()
        val message =
            (obj?.get("message") as? kotlinx.serialization.json.JsonPrimitive)?.content.orEmpty()
        if (code != null) {
            if (httpStatus == 401 || code in UNAUTHORIZED_CODES) {
                return VettaException.Unauthorized(
                    message = message.ifBlank { "未授权" },
                    code = code,
                )
            }
            if (code != 0 || message.isNotBlank()) {
                return VettaException.Api(
                    httpStatus = httpStatus,
                    code = code.takeIf { it != 0 },
                    message = message.ifBlank { "HTTP $httpStatus" },
                    rawBody = body,
                )
            }
        }
    }

    // 网关 OpenAI 错误体
    runCatching {
        VettaJson.decodeFromString(OpenAiErrorBody.serializer(), body)
    }.getOrNull()?.let { openai ->
        val message =
            openai.error?.message
                ?: openai.message
                ?: "HTTP $httpStatus"
        if (httpStatus == 401) {
            return VettaException.Unauthorized(message, openai.error?.code)
        }
        return VettaException.Api(
            httpStatus = httpStatus,
            code = openai.error?.code,
            message = message,
            rawBody = body,
        )
    }

    if (httpStatus == 401) {
        return VettaException.Unauthorized(body.ifBlank { "未授权" })
    }
    return VettaException.Api(
        httpStatus = httpStatus,
        code = null,
        message = body.ifBlank { "HTTP $httpStatus" },
        rawBody = body,
    )
}

internal val UNAUTHORIZED_CODES =
    setOf(
        40100,
        40101,
        40102,
        40103,
        40105,
        40106,
        40107,
    )
