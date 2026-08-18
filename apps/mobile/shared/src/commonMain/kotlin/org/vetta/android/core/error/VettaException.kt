package org.vetta.android.core.error

/**
 * 客户端统一错误类型。
 *
 * - [Api]：业务 API 信封 `{ code, message }` 或网关 OpenAI 错误体
 * - [Unauthorized]：需重新登录（refresh 失败 / 明确 401）
 * - [Network]：网络/超时/解析失败等暂时性错误（不应直接清会话）
 */
sealed class VettaException(
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause) {
    data class Api(
        val httpStatus: Int,
        val code: Int?,
        override val message: String,
        val rawBody: String? = null,
    ) : VettaException(message)

    data class Unauthorized(
        override val message: String = "未授权，请重新登录",
        val code: Int? = null,
    ) : VettaException(message)

    data class Network(
        override val message: String,
        override val cause: Throwable? = null,
    ) : VettaException(message, cause)

    data class Protocol(
        override val message: String,
        override val cause: Throwable? = null,
    ) : VettaException(message, cause)
}
