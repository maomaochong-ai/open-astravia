package org.vetta.android.core.model

data class SubscriptionStatus(
    val active: Boolean,
    val isDefault: Boolean = false,
    val goEnabled: Boolean = false,
    val tierId: Long? = null,
    val tierName: String? = null,
    val badgeText: String? = null,
    val badgeColor: String? = null,
    val description: String? = null,
    val expiresAt: String? = null,
    val windows: List<QuotaWindow> = emptyList(),
)

data class QuotaWindow(
    val kind: String,
    val limit: Double,
    val consumed: Double,
    val resetAt: String? = null,
) {
    val remaining: Double
        get() = (limit - consumed).coerceAtLeast(0.0)
}
