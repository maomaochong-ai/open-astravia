package org.vetta.android.core.api

import kotlin.test.Test
import kotlin.test.assertEquals

class DtoMapperTest {
    @Test
    fun mapsGoModelsCatalog() {
        val dto =
            ModelsCatalogDto(
                providers =
                    mapOf(
                        "vetta-go" to
                            ProviderConfigDto(
                                api = "openai-completions",
                                baseUrl = "http://host/gateway",
                                models =
                                    listOf(
                                        RemoteModelDto(
                                            id = "key-1",
                                            modelId = "gpt-4o",
                                            name = "GPT-4o",
                                            contextWindow = 128000,
                                            maxTokens = 4096,
                                            multiplier = 1.0,
                                            tags = listOf("chat"),
                                        ),
                                    ),
                            ),
                    ),
            )
        val catalog = dto.toDomain()
        val model = catalog.goModels().single()
        assertEquals("key-1", model.id)
        assertEquals("gpt-4o", model.modelId)
        assertEquals("GPT-4o", model.name)
        assertEquals("vetta-go", model.providerName)
        assertEquals("http://host/gateway", model.baseUrl)
    }

    @Test
    fun loginResponsePrefersAccessToken() {
        val session =
            LoginResponseDto(
                token = "old",
                accessToken = "access",
                refreshToken = "refresh",
                user =
                    UserDto(
                        id = 1,
                        username = "u",
                        nickname = "n",
                    ),
            ).toSession()
        assertEquals("access", session.accessToken)
        assertEquals("refresh", session.refreshToken)
        assertEquals("n", session.user.nickname)
    }
}
