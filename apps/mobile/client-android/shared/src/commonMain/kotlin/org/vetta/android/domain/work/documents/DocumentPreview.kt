package org.vetta.android.domain.work.documents

import java.nio.charset.Charset

/**
 * Office documents and delimited tables turned into self-contained pages the phone can
 * show: Word, Excel and PowerPoint in their current (Open XML) formats, and CSV / TSV.
 */
object DocumentPreview {
    /** Extensions shown as a page; the older binary Office formats are not among them. */
    val EXTENSIONS = setOf("docx", "docm", "dotx", "xlsx", "xlsm", "xltx", "pptx", "pptm", "ppsx", "potx", "csv", "tsv")

    /** The page for `data` named `name`, or null when it cannot be read as one. */
    fun html(name: String, data: ByteArray, labels: DocumentLabels): String? =
        try {
            when (name.substringAfterLast('.', "").lowercase()) {
                "docx", "docm", "dotx" -> OoxmlPackage.open(data)?.let(DocxHtml::render)
                "xlsx", "xlsm", "xltx" -> OoxmlPackage.open(data)?.let(XlsxSheets::read)?.let { SheetHtml.render(it, labels) }
                "pptx", "pptm", "ppsx", "potx" -> OoxmlPackage.open(data)?.let(PptxHtml::render)
                "csv" -> SheetHtml.render(listOf(DelimitedSheets.read(name, text(data), tabs = false)), labels)
                "tsv" -> SheetHtml.render(listOf(DelimitedSheets.read(name, text(data), tabs = true)), labels)
                else -> null
            }
        } catch (_: Exception) {
            null
        } catch (_: StackOverflowError) {
            null
        }

    /** A picture the web view draws (an animated GIF, an SVG), centered on a page. Scripts in an SVG do not run as an image. */
    fun image(mimeType: String, data: ByteArray): String =
        HtmlPage.page(
            "body{display:flex;align-items:center;justify-content:center;min-height:100vh}img{display:block}",
            "<img src=\"data:${HtmlPage.escape(mimeType)};base64,${java.util.Base64.getEncoder().encodeToString(data)}\" alt=\"\">",
        )

    /** UTF-8, or GBK for the CSV files Chinese Excel saves. */
    private fun text(data: ByteArray): String =
        runCatching { Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(data)).toString() }.getOrNull()
            ?: String(data, Charset.forName("GBK"))
}
