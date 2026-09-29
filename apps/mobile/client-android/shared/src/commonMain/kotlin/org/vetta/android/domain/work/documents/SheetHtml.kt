package org.vetta.android.domain.work.documents

import org.vetta.android.domain.work.documents.HtmlPage.escape

/** What the document pages say in the reader's language; the screen that shows them supplies it. */
class DocumentLabels(
    /** A sheet with nothing in it. */
    val emptySheet: String,
    /** Only the first `shown` of `total` rows are shown. */
    val rowsShown: (shown: Int, total: Int) -> String,
)

internal class SheetCell(
    val text: String,
    val css: String = "",
    val colSpan: Int = 1,
    val rowSpan: Int = 1,
)

/** One sheet as a grid: cells by position (row and column from 0), merged areas already folded into spans. */
internal class Sheet(
    val name: String,
    val cells: Map<Long, SheetCell>,
    /** Positions another cell's span covers. */
    val covered: Set<Long> = emptySet(),
    /** Widths in CSS pixels by column, where the file sets them. */
    val widths: Map<Int, Int> = emptyMap(),
    /** Rows in the file, when more than were read. */
    val totalRows: Int? = null,
) {
    val rows: Int = (cells.keys.maxOfOrNull { rowOf(it) } ?: -1) + 1
    val columns: Int = (cells.entries.maxOfOrNull { (key, cell) -> columnOf(key) + cell.colSpan - 1 } ?: -1) + 1

    companion object {
        fun key(row: Int, column: Int): Long = row.toLong() shl 20 or column.toLong()

        fun rowOf(key: Long): Int = (key shr 20).toInt()

        fun columnOf(key: Long): Int = (key and 0xFFFFF).toInt()

        const val MAX_ROWS = 3000
        const val MAX_COLUMNS = 200
    }
}

/** Sheets as a page like a spreadsheet's: lettered columns, numbered rows, both kept in view, and tabs between sheets. */
internal object SheetHtml {
    fun render(sheets: List<Sheet>, labels: DocumentLabels): String {
        val body = StringBuilder()
        val tabs = sheets.size > 1
        if (tabs) {
            sheets.indices.forEach { i -> body.append("<input type=\"radio\" name=\"sheet\" class=\"tab\" id=\"t$i\"${if (i == 0) " checked" else ""}>") }
            body.append("<nav>")
            sheets.forEachIndexed { i, sheet -> body.append("<label for=\"t$i\">${escape(sheet.name)}</label>") }
            body.append("</nav>")
        }
        val css = StringBuilder(CSS)
        sheets.forEachIndexed { i, sheet ->
            body.append("<section id=\"s$i\">")
            table(sheet, body, labels)
            body.append("</section>")
            if (tabs) css.append("#t$i:checked~#s$i{display:block}#t$i:checked~nav label[for=t$i]{background:#fff;color:#1d1d1f;font-weight:600}")
        }
        if (tabs) css.append("section{display:none}thead th{top:40px}")
        return HtmlPage.page(css.toString(), body.toString())
    }

    private fun table(sheet: Sheet, out: StringBuilder, labels: DocumentLabels) {
        if (sheet.rows == 0) {
            out.append("<p class=\"note\">${escape(labels.emptySheet)}</p>")
            return
        }
        out.append("<table><colgroup><col class=\"rn\">")
        for (c in 0 until sheet.columns) out.append(sheet.widths[c]?.let { "<col style=\"width:${it}px\">" } ?: "<col>")
        out.append("</colgroup><thead><tr><th></th>")
        for (c in 0 until sheet.columns) out.append("<th>").append(columnName(c)).append("</th>")
        out.append("</tr></thead><tbody>")
        for (r in 0 until sheet.rows) {
            out.append("<tr><th>").append(r + 1).append("</th>")
            for (c in 0 until sheet.columns) {
                val key = Sheet.key(r, c)
                if (key in sheet.covered) continue
                val cell = sheet.cells[key]
                if (cell == null) {
                    out.append("<td></td>")
                    continue
                }
                out.append("<td")
                if (cell.colSpan > 1) out.append(" colspan=\"${cell.colSpan}\"")
                if (cell.rowSpan > 1) out.append(" rowspan=\"${cell.rowSpan}\"")
                if (cell.css.isNotEmpty()) out.append(" style=\"${cell.css}\"")
                out.append(">").append(escape(cell.text)).append("</td>")
            }
            out.append("</tr>")
        }
        out.append("</tbody></table>")
        sheet.totalRows?.let { out.append("<p class=\"note\">${escape(labels.rowsShown(sheet.rows, it))}</p>") }
    }

    /** 0 → A, 25 → Z, 26 → AA. */
    fun columnName(index: Int): String {
        var n = index + 1
        val name = StringBuilder()
        while (n > 0) {
            val rem = (n - 1) % 26
            name.insert(0, 'A' + rem)
            n = (n - 1) / 26
        }
        return name.toString()
    }

    private const val CSS =
        "body{font-size:13px}" +
            "table{border-collapse:separate;border-spacing:0;table-layout:auto}" +
            "td,th{border-right:1px solid #e0e0e5;border-bottom:1px solid #e0e0e5;padding:3px 6px;white-space:pre;min-width:48px;max-width:360px;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom}" +
            "th{background:#f2f2f7;color:#6e6e73;font-weight:500;text-align:center}" +
            "thead th{position:sticky;top:0;z-index:1}" +
            "tbody th{position:sticky;left:0;min-width:32px}" +
            "thead th:first-child{left:0;z-index:2}" +
            "input.tab{display:none}" +
            "nav{position:sticky;top:0;left:0;z-index:3;display:flex;gap:4px;overflow-x:auto;background:#e5e5ea;padding:6px 8px;height:28px;box-sizing:content-box}" +
            "nav label{padding:4px 12px;border-radius:6px;white-space:nowrap;color:#3a3a3c;line-height:20px}"
}
