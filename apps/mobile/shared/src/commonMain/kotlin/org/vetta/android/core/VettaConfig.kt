package org.vetta.android.core

/**
 * 与 desktop `VETTA_SERVER_URL` 对齐的客户端配置。
 *
 * 推荐格式：`http(s)://host:port/api/v1`
 * - REST API 落在 [apiBaseUrl]
 * - LLM Gateway 落在 [gatewayBaseUrl]（`{origin}/gateway`）
 */
data class VettaConfig(
    val serverUrl: String,
    val userAgent: String = "vetta-android/0.1.0",
    val enableHttpLogging: Boolean = false,
) {
    val apiBaseUrl: String
        get() = serverUrl.trim().trimEnd('/')

    /**
     * OpenAI 兼容网关根路径，实际请求为 `{gatewayBaseUrl}/v1/chat/completions`。
     */
    val gatewayBaseUrl: String
        get() {
            val api = apiBaseUrl
            val origin = when {
                api.endsWith("/api/v1") -> api.removeSuffix("/api/v1")
                api.endsWith("/api/v1/") -> api.removeSuffix("/api/v1/")
                else -> api
            }.trimEnd('/')
            return "$origin/gateway"
        }

    init {
        require(serverUrl.isNotBlank()) { "serverUrl must not be blank" }
    }
}
