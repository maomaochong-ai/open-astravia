package org.vetta.android.core.net

import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.auth.Auth
import io.ktor.client.plugins.auth.providers.BearerTokens
import io.ktor.client.plugins.auth.providers.bearer
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.plugins.logging.LogLevel
import io.ktor.client.plugins.logging.Logger
import io.ktor.client.plugins.logging.Logging
import io.ktor.client.request.header
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.vetta.android.core.VettaConfig
import org.vetta.android.core.auth.TokenStore
import org.vetta.android.core.error.VettaException

/**
 * refresh 结果三态，与 desktop 主进程策略对齐：
 * - [Ok]：已换新 token
 * - [Unauthorized]：refresh 失效，应登出
 * - [Transient]：网络/5xx，保留会话
 */
sealed class RefreshOutcome {
    data class Ok(val accessToken: String, val refreshToken: String) : RefreshOutcome()

    data object Unauthorized : RefreshOutcome()

    data object Transient : RefreshOutcome()
}

fun interface UnauthorizedHandler {
    fun onUnauthorized()
}

internal class TokenRefresher(
    private val tokenStore: TokenStore,
    private val refreshAction: suspend (refreshToken: String) -> RefreshOutcome,
    private val onUnauthorized: UnauthorizedHandler?,
) {
    private val mutex = Mutex()

    suspend fun refresh(): RefreshOutcome =
        mutex.withLock {
            val refresh = tokenStore.refreshToken
            if (refresh.isNullOrBlank()) {
                onUnauthorized?.onUnauthorized()
                return@withLock RefreshOutcome.Unauthorized
            }
            val outcome =
                runCatching { refreshAction(refresh) }
                    .getOrElse { RefreshOutcome.Transient }
            when (outcome) {
                is RefreshOutcome.Ok -> {
                    tokenStore.save(outcome.accessToken, outcome.refreshToken)
                }
                RefreshOutcome.Unauthorized -> {
                    tokenStore.clear()
                    onUnauthorized?.onUnauthorized()
                }
                RefreshOutcome.Transient -> Unit
            }
            outcome
        }
}

internal fun createVettaHttpClient(
    config: VettaConfig,
    tokenStore: TokenStore,
    tokenRefresher: TokenRefresher,
): HttpClient =
    HttpClient(platformHttpClientEngine()) {
        expectSuccess = false

        install(ContentNegotiation) {
            json(VettaJson)
        }

        install(HttpTimeout) {
            // 流式对话可能很长；单次 REST 一般远低于此
            requestTimeoutMillis = 600_000
            connectTimeoutMillis = 30_000
            socketTimeoutMillis = 600_000
        }

        if (config.enableHttpLogging) {
            install(Logging) {
                logger =
                    object : Logger {
                        override fun log(message: String) {
                            println("[vetta-http] $message")
                        }
                    }
                level = LogLevel.HEADERS
            }
        }

        install(Auth) {
            bearer {
                loadTokens {
                    val access = tokenStore.accessToken
                    val refresh = tokenStore.refreshToken
                    if (access.isNullOrBlank()) {
                        null
                    } else {
                        BearerTokens(access, refresh.orEmpty())
                    }
                }
                refreshTokens {
                    when (val outcome = tokenRefresher.refresh()) {
                        is RefreshOutcome.Ok ->
                            BearerTokens(outcome.accessToken, outcome.refreshToken)
                        RefreshOutcome.Unauthorized -> null
                        RefreshOutcome.Transient -> null
                    }
                }
                sendWithoutRequest { request ->
                    // true = 发送 Bearer；登录/refresh 等匿名接口必须为 false
                    val path = request.url.toString()
                    !isAnonymousAuthPath(path)
                }
            }
        }

        defaultRequest {
            url(config.apiBaseUrl.trimEnd('/') + "/")
            header(HttpHeaders.UserAgent, config.userAgent)
            contentType(ContentType.Application.Json)
            header(HttpHeaders.Accept, ContentType.Application.Json.toString())
        }
    }

/**
 * 无 Auth 插件的裸客户端，专用于 refresh，避免递归。
 */
internal fun createBareHttpClient(config: VettaConfig): HttpClient =
    HttpClient(platformHttpClientEngine()) {
        expectSuccess = false
        install(ContentNegotiation) {
            json(VettaJson)
        }
        install(HttpTimeout) {
            requestTimeoutMillis = 30_000
            connectTimeoutMillis = 15_000
            socketTimeoutMillis = 30_000
        }
        defaultRequest {
            url(config.apiBaseUrl.trimEnd('/') + "/")
            header(HttpHeaders.UserAgent, config.userAgent)
            contentType(ContentType.Application.Json)
            header(HttpHeaders.Accept, ContentType.Application.Json.toString())
        }
    }

internal fun isAnonymousAuthPath(path: String): Boolean {
    // 兼容完整 URL / 相对 path；统一成以 / 开头的 path 再 endsWith 匹配
    val raw = path.substringBefore('?').trimEnd('/')
    val pathOnly =
        when {
            "://" in raw -> {
                val afterScheme = raw.substringAfter("://")
                val afterHost = afterScheme.substringAfter('/', missingDelimiterValue = "")
                "/$afterHost"
            }
            raw.startsWith("/") -> raw
            else -> "/$raw"
        }
    return pathOnly.endsWith("/auth/login") ||
        pathOnly.endsWith("/auth/refresh") ||
        pathOnly.endsWith("/auth/logout") ||
        pathOnly.endsWith("/auth/sms/send") ||
        pathOnly.endsWith("/auth/sms/login") ||
        pathOnly.endsWith("/auth/email/code") ||
        pathOnly.endsWith("/auth/email/code/login") ||
        pathOnly.endsWith("/auth/email/password/login") ||
        pathOnly.endsWith("/auth/admin/login")
}

internal fun Throwable.toVettaException(): VettaException =
    when (this) {
        is VettaException -> this
        else -> VettaException.Network(message ?: "网络错误", this)
    }
