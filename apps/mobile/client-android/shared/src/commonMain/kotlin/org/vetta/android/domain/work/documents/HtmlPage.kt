package org.vetta.android.domain.work.documents

/** Building the self-contained pages the document previews show: no scripts, nothing fetched. */
internal object HtmlPage {
    fun escape(text: String): String {
        val out = StringBuilder(text.length + 16)
        for (c in text) {
            when (c) {
                '&' -> out.append("&amp;")
                '<' -> out.append("&lt;")
                '>' -> out.append("&gt;")
                '"' -> out.append("&quot;")
                '\'' -> out.append("&#39;")
                else -> out.append(c)
            }
        }
        return out.toString()
    }

    /** A link a page may carry: web and mail addresses only. */
    fun safeHref(href: String): String? {
        val scheme = href.substringBefore(':', "").lowercase()
        return if (scheme in setOf("http", "https", "mailto")) escape(href) else null
    }

    /** `RRGGBB` or `AARRGGBB` as CSS, null for anything else (`auto`, theme names). */
    fun color(hex: String?): String? {
        val value = hex?.trim() ?: return null
        return when {
            value.length == 6 && value.all { it.isHex() } -> "#$value"
            value.length == 8 && value.all { it.isHex() } -> "#${value.substring(2)}"
            else -> null
        }
    }

    private fun Char.isHex() = this in '0'..'9' || this in 'a'..'f' || this in 'A'..'F'

    fun page(css: String, body: String): String =
        """<!DOCTYPE html><html><head><meta charset="utf-8">""" +
            """<meta name="viewport" content="width=device-width, initial-scale=1">""" +
            """<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">""" +
            "<style>$BASE_CSS$css</style></head><body>$body</body></html>"

    private const val BASE_CSS =
        "html{-webkit-text-size-adjust:100%}" +
            "body{margin:0;color:#1d1d1f;background:#fff;font-family:system-ui,-apple-system,Roboto,'Noto Sans CJK SC',sans-serif;line-height:1.45;word-wrap:break-word}" +
            "img{max-width:100%;height:auto}" +
            "a{color:#0a66d8}" +
            ".note{color:#6e6e73;font-size:13px;padding:10px 16px}"
}
