package org.vetta.android.domain.work.documents

import org.w3c.dom.Element
import java.math.BigDecimal
import java.math.MathContext
import java.util.Locale

/**
 * An Excel workbook (.xlsx) as sheets: values as the file last calculated them, shown
 * with their number and date formats, bold, italic, colors, alignment and merged cells.
 * Hidden sheets, charts and pictures are left out.
 */
internal object XlsxSheets {
    fun read(pkg: OoxmlPackage): List<Sheet>? {
        val workbook = pkg.relationships("").values.firstOrNull { it.type.endsWith("/officeDocument") }?.target ?: "xl/workbook.xml"
        val root = pkg.xml(workbook) ?: return null
        val relationships = pkg.relationships(workbook)
        val strings = pkg.related(workbook, "sharedStrings")?.let(pkg::xml)?.children("si")?.map(::richText).orEmpty()
        val styles = Styles(pkg.related(workbook, "styles")?.let(pkg::xml))
        val date1904 = root.child("workbookPr")?.attr("date1904")?.lowercase() in setOf("1", "true")
        return root.child("sheets")?.children("sheet").orEmpty()
            .filter { it.attr("state").let { state -> state == null || state == "visible" } }
            .mapNotNull { entry ->
                val part = entry.rel("id")?.let { relationships[it] }?.target ?: return@mapNotNull null
                val sheet = pkg.xml(part) ?: return@mapNotNull null
                sheet(entry.attr("name").orEmpty(), sheet, strings, styles, date1904)
            }
    }

    private fun sheet(name: String, root: Element, strings: List<String>, styles: Styles, date1904: Boolean): Sheet {
        val cells = HashMap<Long, SheetCell>()
        var totalRows: Int? = null
        var rowIndex = -1
        for (row in root.child("sheetData")?.children("row").orEmpty()) {
            rowIndex = (row.intAttr("r")?.minus(1)) ?: (rowIndex + 1)
            if (rowIndex >= Sheet.MAX_ROWS) {
                totalRows = maxOf(totalRows ?: 0, rowIndex + 1)
                continue
            }
            var columnIndex = -1
            for (c in row.children("c")) {
                columnIndex = c.attr("r")?.let(::columnIndexOf) ?: (columnIndex + 1)
                if (columnIndex >= Sheet.MAX_COLUMNS) continue
                val style = styles.at(c.intAttr("s") ?: 0)
                val text = value(c, strings, style, date1904) ?: continue
                if (text.isEmpty() && style.css.isEmpty()) continue
                cells[Sheet.key(rowIndex, columnIndex)] = SheetCell(text, style.css + alignment(c, style))
            }
        }
        // A total only when rows past the limit hold something.
        if (totalRows != null && totalRows <= Sheet.MAX_ROWS) totalRows = null
        // Formatting often runs far past the data (whole columns filled); blank cells there would only add empty rows.
        val filled = cells.filterValues { it.text.isNotEmpty() }.keys
        val lastRow = filled.maxOfOrNull { Sheet.rowOf(it) } ?: -1
        val lastColumn = filled.maxOfOrNull { Sheet.columnOf(it) } ?: -1
        cells.keys.removeAll { Sheet.rowOf(it) > lastRow || Sheet.columnOf(it) > lastColumn }
        val covered = HashSet<Long>()
        for (merge in root.child("mergeCells")?.children("mergeCell").orEmpty()) {
            val (from, to) = merge.attr("ref")?.split(':')?.takeIf { it.size == 2 } ?: continue
            val top = rowIndexOf(from) ?: continue
            val left = columnIndexOf(from) ?: continue
            val bottom = (rowIndexOf(to) ?: continue).coerceAtMost(Sheet.MAX_ROWS - 1)
            val right = (columnIndexOf(to) ?: continue).coerceAtMost(Sheet.MAX_COLUMNS - 1)
            if (top >= Sheet.MAX_ROWS || left >= Sheet.MAX_COLUMNS || (top == bottom && left == right)) continue
            val anchor = cells[Sheet.key(top, left)] ?: SheetCell("")
            cells[Sheet.key(top, left)] = SheetCell(anchor.text, anchor.css, right - left + 1, bottom - top + 1)
            for (r in top..bottom) for (col in left..right) if (r != top || col != left) {
                covered += Sheet.key(r, col)
                cells.remove(Sheet.key(r, col))
            }
        }
        val widths = HashMap<Int, Int>()
        for (col in root.child("cols")?.children("col").orEmpty()) {
            val width = col.attr("width")?.toDoubleOrNull() ?: continue
            val from = (col.intAttr("min") ?: continue) - 1
            val to = ((col.intAttr("max") ?: continue) - 1).coerceAtMost(Sheet.MAX_COLUMNS - 1)
            for (i in from..to) widths[i] = (width * 7 + 5).toInt().coerceIn(24, 480)
        }
        return Sheet(name, cells, covered, widths, totalRows)
    }

    private fun value(c: Element, strings: List<String>, style: CellStyle, date1904: Boolean): String? {
        val raw = c.child("v")?.textContent?.takeIf { it.isNotEmpty() }
        // A workbook written by a script often has formulas no spreadsheet has calculated yet.
        if (raw == null && c.attr("t") != "inlineStr") return c.child("f")?.textContent?.takeIf { it.isNotBlank() }?.let { "=$it" }
        return when (c.attr("t")) {
            "s" -> raw?.trim()?.toIntOrNull()?.let { strings.getOrNull(it) }
            "inlineStr" -> c.child("is")?.let(::richText)
            "str", "e", "d" -> raw
            "b" -> if (raw?.trim() == "1") "TRUE" else if (raw != null) "FALSE" else null
            else -> raw?.trim()?.toDoubleOrNull()?.let { NumberFormats.format(it, style.format, date1904) } ?: raw
        }
    }

    private fun alignment(c: Element, style: CellStyle): String =
        when {
            style.align != null -> "text-align:${style.align};"
            c.attr("t") == "b" || c.attr("t") == "e" -> "text-align:center;"
            c.attr("t") == null || c.attr("t") == "n" -> "text-align:right;"
            else -> ""
        }

    /** A shared or inline string: its text, or its runs' text, without phonetic guides. */
    private fun richText(si: Element): String = si.child("t")?.textContent ?: si.children("r").joinToString("") { it.child("t")?.textContent.orEmpty() }

    /** "B3" → 1. */
    fun columnIndexOf(ref: String): Int? {
        var index = 0
        var letters = 0
        for (ch in ref) {
            val upper = ch.uppercaseChar()
            if (upper !in 'A'..'Z') break
            index = index * 26 + (upper - 'A' + 1)
            letters++
        }
        return if (letters == 0) null else index - 1
    }

    /** "B3" → 2. */
    fun rowIndexOf(ref: String): Int? = ref.dropWhile { it.isLetter() || it == '$' }.toIntOrNull()?.minus(1)

    private class CellStyle(val format: String, val css: String, val align: String?)

    private class Styles(root: Element?) {
        private val formats = root?.child("numFmts")?.children("numFmt")?.associate { (it.intAttr("numFmtId") ?: -1) to it.attr("formatCode").orEmpty() }.orEmpty()
        private val fonts = root?.child("fonts")?.children("font").orEmpty()
        private val fills = root?.child("fills")?.children("fill").orEmpty()
        private val xfs = root?.child("cellXfs")?.children("xf").orEmpty()
        private val cache = HashMap<Int, CellStyle>()

        fun at(index: Int): CellStyle = cache.getOrPut(index) { build(xfs.getOrNull(index)) }

        private fun build(xf: Element?): CellStyle {
            if (xf == null) return CellStyle("General", "", null)
            val id = xf.intAttr("numFmtId") ?: 0
            val format = formats[id] ?: NumberFormats.builtIn(id)
            val css = StringBuilder()
            fonts.getOrNull(xf.intAttr("fontId") ?: -1)?.let { font ->
                if (font.child("b").isOn()) css.append("font-weight:bold;")
                if (font.child("i").isOn()) css.append("font-style:italic;")
                if (font.child("u").isOn()) css.append("text-decoration:underline;")
                if (font.child("strike").isOn()) css.append("text-decoration:line-through;")
                HtmlPage.color(font.child("color")?.attr("rgb"))?.takeUnless { it.equals("#000000", true) }?.let { css.append("color:$it;") }
            }
            fills.getOrNull(xf.intAttr("fillId") ?: -1)?.child("patternFill")?.takeIf { it.attr("patternType") == "solid" }?.let { fill ->
                HtmlPage.color(fill.child("fgColor")?.attr("rgb"))?.let { css.append("background:$it;") }
            }
            val alignment = xf.child("alignment")
            if (alignment?.attr("wrapText").let { it == "1" || it == "true" }) css.append("white-space:pre-wrap;")
            val align =
                when (alignment?.attr("horizontal")) {
                    "center", "centerContinuous" -> "center"
                    "right" -> "right"
                    "left" -> "left"
                    "justify", "distributed" -> "justify"
                    else -> null
                }
            return CellStyle(format, css.toString(), align)
        }
    }
}

/** Excel number formats, near enough for reading: decimals, grouping, percent, currency, dates and times. */
internal object NumberFormats {
    fun builtIn(id: Int): String =
        when (id) {
            1 -> "0"
            2 -> "0.00"
            3 -> "#,##0"
            4 -> "#,##0.00"
            9 -> "0%"
            10 -> "0.00%"
            11, 48 -> "0.00E+00"
            14, in 27..31, in 34..36, in 50..58 -> "yyyy-mm-dd"
            15, 16, 17 -> "yyyy-mm-dd"
            18, 20, 32, 33 -> "h:mm"
            19, 21, 45 -> "h:mm:ss"
            22 -> "yyyy-mm-dd h:mm"
            37, 38 -> "#,##0"
            39, 40 -> "#,##0.00"
            46 -> "[h]:mm:ss"
            49 -> "@"
            else -> "General"
        }

    fun format(value: Double, code: String, date1904: Boolean = false): String {
        val section = firstSection(code)
        val bare = section.replace(Regex("\"[^\"]*\""), "").replace(Regex("\\[[^\\]]*\\]"), "").replace(Regex("\\\\."), "")
        if (section.equals("General", ignoreCase = true) || section.isBlank() || section == "@") return general(value)
        if (bare.any { it in "yYdD" } || (bare.any { it in "hHsS" } && !bare.contains('0') && !bare.contains('#'))) {
            return dateTime(value, bare, section.contains("[h]", ignoreCase = true), date1904)
        }
        if (section.contains("E+", ignoreCase = true)) return String.format(Locale.ROOT, "%.2E", value)
        val percent = bare.contains('%')
        val shown = if (percent) value * 100 else value
        val number = bare.substringAfter('.', "")
        val decimals = if (bare.contains('.')) number.takeWhile { it == '0' || it == '#' }.length else 0
        val grouping = bare.contains(',')
        val pattern = "%" + (if (grouping) "," else "") + ".${decimals}f"
        val digits = String.format(Locale.ROOT, pattern, kotlin.math.abs(shown))
        val (prefix, suffix) = affixes(section)
        val sign = if (shown < 0 && BigDecimal(digits.replace(",", "")).signum() != 0) "-" else ""
        return sign + prefix + digits + (if (percent) "%" else "") + suffix
    }

    /** The positive section of a format: before the first `;` outside quotes. */
    private fun firstSection(code: String): String {
        var quoted = false
        for ((i, c) in code.withIndex()) {
            if (c == '"') quoted = !quoted
            if (c == ';' && !quoted) return code.substring(0, i)
        }
        return code
    }

    /** Literal text around the digits: currency symbols and units. */
    private fun affixes(section: String): Pair<String, String> {
        val cleaned =
            section
                .replace(Regex("\\[\\$([^\\]-]*)[^\\]]*\\]"), "\"$1\"")
                .replace(Regex("\\[[^\\]]*\\]"), "")
                .replace(Regex("[_*]."), "")
        val first = cleaned.indexOfFirst { it in "0#?" }
        val last = cleaned.indexOfLast { it in "0#?%" }
        if (first < 0) return "" to ""
        return literal(cleaned.substring(0, first)) to literal(cleaned.substring(last + 1).replace("%", ""))
    }

    private fun literal(text: String): String = text.replace(Regex("\"([^\"]*)\""), "$1").replace(Regex("\\\\(.)"), "$1").replace("(", "").replace(")", "").trim()

    fun general(value: Double): String {
        if (value == kotlin.math.floor(value) && kotlin.math.abs(value) < 1e15) return value.toLong().toString()
        val magnitude = kotlin.math.abs(value)
        if (magnitude != 0.0 && (magnitude < 1e-9 || magnitude >= 1e15)) return String.format(Locale.ROOT, "%.5E", value)
        return BigDecimal(value).round(MathContext(10)).stripTrailingZeros().toPlainString()
    }

    private fun dateTime(serial: Double, bare: String, elapsed: Boolean, date1904: Boolean): String {
        val lower = bare.lowercase()
        val hasDate = lower.any { it in "yd" } || (lower.contains('m') && !lower.contains('h') && !lower.contains('s'))
        val hasTime = lower.any { it in "hs" }
        val seconds = lower.contains('s')
        var days = kotlin.math.floor(serial).toLong()
        var secondsOfDay = Math.round((serial - days) * 86_400)
        if (secondsOfDay >= 86_400) {
            days += 1
            secondsOfDay -= 86_400
        }
        val time = buildString {
            val hours = if (elapsed) days * 24 + secondsOfDay / 3600 else secondsOfDay / 3600
            append(if (elapsed) hours.toString() else hours.toString().padStart(2, '0'))
            append(':').append((secondsOfDay / 60 % 60).toString().padStart(2, '0'))
            if (seconds) append(':').append((secondsOfDay % 60).toString().padStart(2, '0'))
        }
        if (elapsed || !hasDate) return time
        // Serial 60 is Excel's fictional 29 February 1900; days from 1 March count from 30 December 1899.
        val epochDay = if (date1904) days + EPOCH_1904 else if (days < 61) days + EPOCH_1900 + 1 else days + EPOCH_1900
        val date = civil(epochDay)
        return if (hasTime) "$date $time" else date
    }

    /** Days since 1970-01-01 of 1899-12-30 and 1904-01-01. */
    private const val EPOCH_1900 = -25_569L
    private const val EPOCH_1904 = -24_107L

    /** A day count from 1970-01-01 as `yyyy-mm-dd` (the proleptic Gregorian calendar). */
    private fun civil(epochDay: Long): String {
        val z = epochDay + 719_468
        val era = (if (z >= 0) z else z - 146_096) / 146_097
        val doe = z - era * 146_097
        val yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
        val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        val mp = (5 * doy + 2) / 153
        val day = doy - (153 * mp + 2) / 5 + 1
        val month = if (mp < 10) mp + 3 else mp - 9
        val year = yoe + era * 400 + (if (month <= 2) 1 else 0)
        return "$year-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}"
    }
}
