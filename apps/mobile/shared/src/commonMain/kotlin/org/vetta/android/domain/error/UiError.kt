package org.vetta.android.domain.error

import org.vetta.android.core.error.VettaException

enum class UiErrorAction {
    None,
    Retry,
    OpenPlan,
    ReLogin,
    OpenSettings,
}

/**
 * 展示层错误：稳定文案 + 可选行动，禁止把 raw JSON 抛到 UI。
 */
data class UiError(
    val title: String,
    val message: String,
    val action: UiErrorAction = UiErrorAction.None,
    val technicalCode: Int? = null,
)

object ErrorMapper {
    fun from(throwable: Throwable): UiError =
        when (val e = throwable as? VettaException ?: throwable) {
            is VettaException.Unauthorized ->
                UiError(
                    title = "需要重新登录",
                    message = e.message.ifBlank { "登录已失效，请重新登录" },
                    action = UiErrorAction.ReLogin,
                    technicalCode = e.code,
                )
            is VettaException.Network ->
                UiError(
                    title = "网络异常",
                    message = "暂时连不上服务器，请检查网络后重试",
                    action = UiErrorAction.Retry,
                )
            is VettaException.Protocol ->
                UiError(
                    title = "响应异常",
                    message = "服务器返回了无法理解的内容，请稍后重试",
                    action = UiErrorAction.Retry,
                )
            is VettaException.Api -> mapApi(e)
            else ->
                UiError(
                    title = "出错了",
                    message = throwable.message?.takeIf { it.isNotBlank() } ?: "未知错误",
                    action = UiErrorAction.Retry,
                )
        }

    private fun mapApi(e: VettaException.Api): UiError {
        val code = e.code
        return when (code) {
            40301 ->
                UiError(
                    title = "服务暂不可用",
                    message = "Vetta Go 当前未开放，请稍后再试",
                    action = UiErrorAction.OpenPlan,
                    technicalCode = code,
                )
            40302 ->
                UiError(
                    title = "暂无有效方案",
                    message = "当前账号没有可用的对话额度，请查看套餐状态",
                    action = UiErrorAction.OpenPlan,
                    technicalCode = code,
                )
            40303 ->
                UiError(
                    title = "模型不可用",
                    message = "当前方案不包含所选模型，请更换模型或查看套餐",
                    action = UiErrorAction.OpenPlan,
                    technicalCode = code,
                )
            42902 ->
                UiError(
                    title = "额度已用尽",
                    message = e.message.ifBlank { "订阅额度已用尽，额度将在窗口重置后恢复" },
                    action = UiErrorAction.OpenPlan,
                    technicalCode = code,
                )
            42901, 42900 ->
                UiError(
                    title = "请求过于频繁",
                    message = "请稍后再试",
                    action = UiErrorAction.Retry,
                    technicalCode = code,
                )
            40104 ->
                UiError(
                    title = "登录失败",
                    message = "账号或密码不正确",
                    action = UiErrorAction.None,
                    technicalCode = code,
                )
            40414 ->
                UiError(
                    title = "模型不存在",
                    message = "所选模型已下线，请重新选择",
                    action = UiErrorAction.Retry,
                    technicalCode = code,
                )
            else ->
                UiError(
                    title = "请求失败",
                    message = e.message.ifBlank { "服务器返回错误（${e.httpStatus}）" },
                    action = if (e.httpStatus >= 500) UiErrorAction.Retry else UiErrorAction.None,
                    technicalCode = code,
                )
        }
    }
}
