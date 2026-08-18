package org.vetta.android.core

import kotlinx.coroutines.flow.StateFlow
import org.vetta.android.core.api.VettaApi
import org.vetta.android.core.auth.StoredTokens
import org.vetta.android.core.auth.TokenStore
import org.vetta.android.core.model.AuthSession
import org.vetta.android.core.model.User
import org.vetta.android.core.net.RefreshOutcome
import org.vetta.android.core.net.TokenRefresher

class AuthRepository internal constructor(
    private val api: VettaApi,
    private val tokenStore: TokenStore,
    private val tokenRefresher: TokenRefresher,
) {
    val tokens: StateFlow<StoredTokens?> = tokenStore.tokens

    val isLoggedIn: Boolean
        get() = !tokenStore.accessToken.isNullOrBlank()

    suspend fun loginWithAccount(account: String, password: String): AuthSession =
        api.loginWithAccount(account.trim(), password)

    suspend fun loginWithEmailPassword(email: String, password: String): AuthSession =
        api.loginWithEmailPassword(email.trim(), password)

    suspend fun loginWithSms(phone: String, code: String): AuthSession =
        api.loginWithSms(phone.trim(), code.trim())

    suspend fun sendSmsCode(phone: String) {
        api.sendSmsCode(phone.trim())
    }

    /**
     * 主动刷新 token。返回三态，调用方按 desktop 策略处理：
     * Unauthorized → 登出；Transient → 保留会话。
     */
    suspend fun refresh(): RefreshOutcome = tokenRefresher.refresh()

    suspend fun logout() {
        runCatching { api.logout() }
        tokenStore.clear()
    }

    suspend fun me(): User = api.me()

    fun clearLocalSession() {
        tokenStore.clear()
    }
}
