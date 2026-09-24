package org.vetta.android.domain.error

import org.vetta.android.core.error.VettaException
import org.vetta.android.resources.Res
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

}
