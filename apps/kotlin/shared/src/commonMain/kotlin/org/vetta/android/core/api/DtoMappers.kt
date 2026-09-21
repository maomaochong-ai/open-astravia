package org.vetta.android.core.api

import org.vetta.android.core.model.AuthSession
import org.vetta.android.core.model.LlmModel
import org.vetta.android.core.model.ModelsCatalog
import org.vetta.android.core.model.ProviderModels
import org.vetta.android.core.model.QuotaWindow
import org.vetta.android.core.model.SubscriptionStatus
import org.vetta.android.core.model.TokenPair
import org.vetta.android.core.model.TokenUsage
import org.vetta.android.core.model.User

internal fun UserDto.toDomain(): User =
    User(
        id = id,
        username = username,
        nickname = nickname.ifBlank { username },
        phone = phone,
        email = email,
        avatar = avatar,
        isActive = isActive,
        createdAt = createdAt,
    )

internal fun LoginResponseDto.toSession(): AuthSession {
    val access = accessToken ?: token
    require(!access.isNullOrBlank()) { "login response missing access_token" }
    require(!refreshToken.isNullOrBlank()) { "login response missing refresh_token" }
    return AuthSession(
        accessToken = access,
        refreshToken = refreshToken,
        user = user.toDomain(),
        requiresPassword = requiresPassword,
    )
}

internal fun RefreshResponseDto.toTokenPair(): TokenPair =
    TokenPair(accessToken = accessToken, refreshToken = refreshToken)

internal fun SubscriptionStatusDto.toDomain(): SubscriptionStatus =
    SubscriptionStatus(
        active = active,
        isDefault = isDefault,
        goEnabled = goEnabled,
        tierId = tierId,
        tierName = tierName,
        badgeText = badgeText,
        badgeColor = badgeColor,
        description = description,
        expiresAt = expiresAt,
        windows = windows.map { it.toDomain() },
    )

internal fun QuotaWindowDto.toDomain(): QuotaWindow =
    QuotaWindow(
        kind = kind,
        limit = limit,
        consumed = consumed,
        resetAt = resetAt,
    )

internal fun ModelsCatalogDto.toDomain(): ModelsCatalog {
    val mapped =
        providers.mapValues { (providerName, config) ->
            ProviderModels(
                name = providerName,
                api = config.api,
                baseUrl = config.baseUrl,
                models =
                    config.models.map { model ->
                        model.toDomain(
                            providerName = providerName,
                            providerApi = config.api,
                            providerBaseUrl = config.baseUrl,
                        )
                    },
            )
        }
    return ModelsCatalog(providers = mapped)
}

internal fun RemoteModelDto.toDomain(
    providerName: String,
    providerApi: String?,
    providerBaseUrl: String?,
): LlmModel =
    LlmModel(
        id = id,
        modelId = modelId ?: id,
        name = name?.takeIf { it.isNotBlank() } ?: modelId ?: id,
        providerName = providerName,
        api = api ?: providerApi,
        baseUrl = providerBaseUrl,
        reasoning = reasoning,
        input = input,
        contextWindow = contextWindow,
        maxTokens = maxTokens,
        multiplier = multiplier,
        tags = tags,
        reasoningLevels = reasoningLevels,
        defaultReasoningLevel = defaultReasoningLevel,
    )

internal fun ChatUsageDto.toDomain(): TokenUsage =
    TokenUsage(
        promptTokens = promptTokens,
        completionTokens = completionTokens,
        totalTokens = totalTokens,
    )
