package org.vetta.android.domain.work

import java.text.Normalizer

private val COMBINING_MARKS = Regex("\\p{Mn}+")

internal actual fun stripAccents(text: String): String =
    COMBINING_MARKS.replace(Normalizer.normalize(text, Normalizer.Form.NFD), "")
