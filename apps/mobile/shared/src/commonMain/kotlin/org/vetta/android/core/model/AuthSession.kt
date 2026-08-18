package org.vetta.android.core.model

data class AuthSession(
    val accessToken: String,
    val refreshToken: String,
    val user: User,
    val requiresPassword: Boolean = false,
)

data class TokenPair(
    val accessToken: String,
    val refreshToken: String,
)
