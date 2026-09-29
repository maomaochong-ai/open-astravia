package org.vetta.android.core

/**
 * What the desktop calls this phone: the name the owner gave it in the system settings
 * ("Xiaomi 14", "Alex's Pixel"), else maker and model. Models are often codes such as
 * "24031PN0DC", so the maker comes first to make them recognisable.
 */
object DeviceName {
    fun pick(userName: String?, manufacturer: String?, model: String?): String {
        userName?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        val maker = manufacturer?.trim().orEmpty().replaceFirstChar { it.uppercase() }
        val code = model?.trim().orEmpty()
        return when {
            code.isEmpty() -> maker.ifEmpty { "Android" }
            maker.isEmpty() || code.startsWith(maker, ignoreCase = true) -> code
            else -> "$maker $code"
        }
    }
}
