package org.vetta.android.domain.error

import org.vetta.android.core.error.VettaException
import org.vetta.android.domain.conversation.RemoteConversationException
import org.vetta.android.domain.remote.connection.RemoteRequestException
import org.vetta.android.domain.remote.protocol.RemoteErrorCode
import org.vetta.android.resources.Res
import org.vetta.android.resources.error_client_message
import org.vetta.android.resources.error_desktop_auth_message
import org.vetta.android.resources.error_desktop_auth_title
import org.vetta.android.resources.error_desktop_busy_title
import org.vetta.android.resources.error_desktop_failed_message
import org.vetta.android.resources.error_desktop_failed_title
import org.vetta.android.resources.error_desktop_link_message
import org.vetta.android.resources.error_desktop_link_title
import org.vetta.android.resources.error_desktop_not_found_message
import org.vetta.android.resources.error_desktop_not_found_title
import org.vetta.android.resources.error_desktop_unavailable_message
import org.vetta.android.resources.error_desktop_unavailable_title
import org.vetta.android.resources.error_generic
import org.vetta.android.resources.error_generic_message
import org.vetta.android.resources.error_login_failed_message
import org.vetta.android.resources.error_login_failed_title
import org.vetta.android.resources.error_model_missing_message
import org.vetta.android.resources.error_model_missing_title
import org.vetta.android.resources.error_model_not_in_plan_message
import org.vetta.android.resources.error_model_not_in_plan_title
import org.vetta.android.resources.error_network_message
import org.vetta.android.resources.error_network_title
import org.vetta.android.resources.error_no_plan_message
import org.vetta.android.resources.error_no_plan_title
import org.vetta.android.resources.error_protocol_message
import org.vetta.android.resources.error_protocol_title
import org.vetta.android.resources.error_quota_message
import org.vetta.android.resources.error_quota_title
import org.vetta.android.resources.error_rate_limit_title
import org.vetta.android.resources.error_relogin_message
import org.vetta.android.resources.error_relogin_title
import org.vetta.android.resources.error_request_failed_title
import org.vetta.android.resources.error_server_message
import org.vetta.android.resources.error_service_unavailable_message
import org.vetta.android.resources.error_service_unavailable_title
import org.vetta.android.resources.error_try_later
import org.vetta.android.ui.i18n.UiText
import org.vetta.android.ui.i18n.uiText

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
    val title: UiText,
    val message: UiText,
    val action: UiErrorAction = UiErrorAction.None,
    val technicalCode: Int? = null,
)

object ErrorMapper {
    fun from(throwable: Throwable): UiError =
        when (val e = throwable as? VettaException ?: throwable) {
            is VettaException.Unauthorized ->
                UiError(
                    title = uiText(Res.string.error_relogin_title),
                    message = uiText(Res.string.error_relogin_message),
                    action = UiErrorAction.ReLogin,
                    technicalCode = e.code,
                )
            is VettaException.Network ->
                UiError(
                    title = uiText(Res.string.error_network_title),
                    message = uiText(Res.string.error_network_message),
                    action = UiErrorAction.Retry,
                )
            is VettaException.Protocol ->
                UiError(
                    title = uiText(Res.string.error_protocol_title),
                    message = uiText(Res.string.error_protocol_message),
                    action = UiErrorAction.Retry,
                )
            is VettaException.Api -> mapApi(e)
            is RemoteConversationException ->
                UiError(
                    title = uiText(Res.string.error_desktop_unavailable_title),
                    message = uiText(Res.string.error_desktop_unavailable_message),
                    action = UiErrorAction.Retry,
                )
            is RemoteRequestException -> mapRemoteRequest(e)
            else ->
                UiError(
                    title = uiText(Res.string.error_generic),
                    message = uiText(Res.string.error_generic_message),
                    action = UiErrorAction.Retry,
                )
        }

    private fun mapRemoteRequest(e: RemoteRequestException): UiError =
        when (e.remoteError.code) {
            RemoteErrorCode.Unauthorized,
            RemoteErrorCode.ApprovalRejected,
            ->
                UiError(
                    title = uiText(Res.string.error_desktop_auth_title),
                    message = uiText(Res.string.error_desktop_auth_message),
                )
            RemoteErrorCode.NotFound ->
                UiError(
                    title = uiText(Res.string.error_desktop_not_found_title),
                    message = uiText(Res.string.error_desktop_not_found_message),
                )
            RemoteErrorCode.Busy ->
                UiError(
                    title = uiText(Res.string.error_desktop_busy_title),
                    message = uiText(Res.string.error_try_later),
                    action = UiErrorAction.Retry,
                )
            RemoteErrorCode.RequestTimeout,
            RemoteErrorCode.TransportClosed,
            ->
                UiError(
                    title = uiText(Res.string.error_desktop_link_title),
                    message = uiText(Res.string.error_desktop_link_message),
                    action = UiErrorAction.Retry,
                )
            RemoteErrorCode.InvalidFrame,
            RemoteErrorCode.UnsupportedVersion,
            RemoteErrorCode.InternalError,
            ->
                UiError(
                    title = uiText(Res.string.error_desktop_failed_title),
                    message = uiText(Res.string.error_desktop_failed_message),
                    action = UiErrorAction.Retry,
                )
        }

    private fun mapApi(e: VettaException.Api): UiError {
        val code = e.code
        return when (code) {
            40301 ->
                UiError(
                    title = uiText(Res.string.error_service_unavailable_title),
                    message = uiText(Res.string.error_service_unavailable_message),
                    action = UiErrorAction.OpenPlan,
                    technicalCode = code,
                )
            40302 ->
                UiError(
                    title = uiText(Res.string.error_no_plan_title),
                    message = uiText(Res.string.error_no_plan_message),
                    action = UiErrorAction.OpenPlan,
                    technicalCode = code,
                )
            40303 ->
                UiError(
                    title = uiText(Res.string.error_model_not_in_plan_title),
                    message = uiText(Res.string.error_model_not_in_plan_message),
                    action = UiErrorAction.OpenPlan,
                    technicalCode = code,
                )
            42902 ->
                UiError(
                    title = uiText(Res.string.error_quota_title),
                    message = uiText(Res.string.error_quota_message),
                    action = UiErrorAction.OpenPlan,
                    technicalCode = code,
                )
            42901, 42900 ->
                UiError(
                    title = uiText(Res.string.error_rate_limit_title),
                    message = uiText(Res.string.error_try_later),
                    action = UiErrorAction.Retry,
                    technicalCode = code,
                )
            40104 ->
                UiError(
                    title = uiText(Res.string.error_login_failed_title),
                    message = uiText(Res.string.error_login_failed_message),
                    action = UiErrorAction.None,
                    technicalCode = code,
                )
            40414 ->
                UiError(
                    title = uiText(Res.string.error_model_missing_title),
                    message = uiText(Res.string.error_model_missing_message),
                    action = UiErrorAction.Retry,
                    technicalCode = code,
                )
            else ->
                UiError(
                    title = uiText(Res.string.error_request_failed_title),
                    message =
                        if (e.httpStatus >= 500) {
                            uiText(Res.string.error_server_message)
                        } else {
                            uiText(Res.string.error_client_message)
                        },
                    action = if (e.httpStatus >= 500) UiErrorAction.Retry else UiErrorAction.None,
                    technicalCode = code,
                )
        }
    }
}
