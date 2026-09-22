package org.vetta.android.core.model

data class User(
    val id: Long,
    val username: String,
    val nickname: String,
    val phone: String? = null,
    val email: String? = null,
    val avatar: String = "",
    val isActive: Boolean = true,
    val createdAt: String? = null,
)
