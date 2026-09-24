package org.vetta.android.domain.error

import org.vetta.android.core.error.VettaException
import org.vetta.android.domain.conversation.RemoteConversationException
import org.vetta.android.domain.remote.connection.RemoteRequestException
import org.vetta.android.domain.remote.protocol.RemoteError
import org.vetta.android.domain.remote.protocol.RemoteErrorCode
import org.vetta.android.resources.Res
import org.vetta.android.resources.error_desktop_auth_message
import org.vetta.android.resources.error_desktop_auth_title
import org.vetta.android.resources.error_desktop_unavailable_message
import org.vetta.android.resources.error_generic_message
import org.vetta.android.resources.error_quota_title
import org.vetta.android.resources.error_server_message
import org.vetta.android.ui.i18n.uiText
import kotlin.test.Test
import kotlin.test.assertEquals

class ErrorMapperTest {
    @Test
    fun mapsQuotaToOpenPlan() {
        val ui =
            ErrorMapper.from(
                VettaException.Api(httpStatus = 429, code = 42902, message = "额度尽"),
            )
        assertEquals(UiErrorAction.OpenPlan, ui.action)
        assertEquals(uiText(Res.string.error_quota_title), ui.title)
    }

    @Test
    fun mapsUnauthorized() {
        val ui = ErrorMapper.from(VettaException.Unauthorized())
        assertEquals(UiErrorAction.ReLogin, ui.action)
    }

    @Test
    fun mapsRemoteAuthenticationFailureWithoutExposingProviderMessage() {
        val ui =
            ErrorMapper.from(
                RemoteRequestException(
                    RemoteError(
                        code = RemoteErrorCode.Unauthorized,
                        message = "invalid key suffix: sensitive",
                        retryable = false,
                    ),
                ),
            )

        assertEquals(uiText(Res.string.error_desktop_auth_title), ui.title)
        assertEquals(uiText(Res.string.error_desktop_auth_message), ui.message)
        assertEquals(UiErrorAction.None, ui.action)
    }

    @Test
    fun doesNotExposeUnknownExceptionMessage() {
        val ui = ErrorMapper.from(IllegalStateException("token=secret-value"))

        assertEquals(uiText(Res.string.error_generic_message), ui.message)
    }

    @Test
    fun doesNotExposeUnknownApiMessage() {
        val ui =
            ErrorMapper.from(
                VettaException.Api(
                    httpStatus = 500,
                    code = 50000,
                    message = "upstream secret response",
                ),
            )

        assertEquals(uiText(Res.string.error_server_message), ui.message)
    }

    @Test
    fun doesNotExposeRemoteConversationMessage() {
        val ui = ErrorMapper.from(RemoteConversationException("relay target contained a secret"))

        assertEquals(uiText(Res.string.error_desktop_unavailable_message), ui.message)
    }
}
