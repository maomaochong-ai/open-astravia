package org.vetta.android.ui.i18n

import androidx.compose.runtime.Composable
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource

/**
 * 用户可见文案的延迟形态：ViewModel 与领域层没有 Compose 上下文，只记下资源与参数，
 * 由界面按系统语言解析。[Raw] 只用于来自桌面或用户的原文。
 */
sealed interface UiText {
    data class Resource(val res: StringResource, val args: List<Any> = emptyList()) : UiText

    data class Raw(val value: String) : UiText

    /** Stable, language-independent identity, for persistence and logs. */
    val key: String
        get() =
            when (this) {
                is Resource -> res.key
                is Raw -> value
            }
}

fun uiText(res: StringResource, vararg args: Any): UiText = UiText.Resource(res, args.toList())

@Composable
fun UiText.resolve(): String =
    when (this) {
        is UiText.Resource -> stringResource(res, *args.toTypedArray())
        is UiText.Raw -> value
    }
