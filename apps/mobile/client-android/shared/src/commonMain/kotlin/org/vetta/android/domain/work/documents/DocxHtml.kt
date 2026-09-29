package org.vetta.android.domain.work.documents

import org.vetta.android.domain.work.documents.HtmlPage.escape
import org.w3c.dom.Element
import java.util.Locale

/**
 * A Word document (.docx) as a page: paragraphs with their headings, alignment and
 * character formatting, numbered and bulleted lists, tables with merged cells, pictures,
 * text boxes and web links. Headers, footers, comments and charts are left out.
 */
internal class DocxHtml private constructor(private val pkg: OoxmlPackage, private val main: String) {
    private val relationships = pkg.relationships(main)
    private val styles = Styles(pkg.xml(pkg.related(main, "styles") ?: "word/styles.xml"))
    private val numbering = Numbering(pkg.xml(pkg.related(main, "numbering") ?: "word/numbering.xml"))
    private val out = StringBuilder()

    /** Text boxes met inside the paragraph being built, shown after it. */
    private val boxes = StringBuilder()

    private fun render(): String? {
        val body = pkg.xml(main)?.child("body") ?: return null
        blocks(body)
        return HtmlPage.page(CSS, "<article>$out</article>")
    }

    private fun blocks(parent: Element) {
        for (element in parent.elements()) {
            when (element.local) {
                "p" -> paragraph(element)
                "tbl" -> table(element)
                "sdt" -> element.child("sdtContent")?.let(::blocks)
                "customXml", "ins", "smartTag" -> blocks(element)
                "AlternateContent" -> element.chosen()?.let(::blocks)
            }
        }
    }

    private fun paragraph(p: Element) {
        val properties = p.child("pPr")
        val styleId = properties?.path("pStyle")?.attr("val")
        if (properties?.child("pageBreakBefore").isOn()) out.append("<hr class=\"page\">")
        val content = StringBuilder()
        inline(p, content)
        val heading = styles.headingLevel(styleId, properties?.path("outlineLvl")?.intAttr("val"))
        val style = StringBuilder()
        when (properties?.path("jc")?.attr("val")) {
            "center" -> style.append("text-align:center;")
            "right", "end" -> style.append("text-align:right;")
            "both", "distribute" -> style.append("text-align:justify;")
        }
        val list = numbering.label(properties?.child("numPr") ?: styles.numPr(styleId))
        when {
            list != null -> {
                style.append("margin-left:${1.6 * (list.level + 1)}em;text-indent:-1.3em;")
                out.append("<p class=\"li\" style=\"$style\"><span class=\"n\">${escape(list.text)}</span>$content</p>")
            }
            heading != null -> out.append("<h$heading style=\"$style\">$content</h$heading>")
            else -> {
                properties?.path("ind")?.let { ind ->
                    val left = (ind.intAttr("left") ?: ind.intAttr("start"))?.takeIf { it > 0 }
                    if (left != null) style.append("margin-left:${left / 20}pt;")
                    ind.intAttr("firstLine")?.takeIf { it > 0 }?.let { style.append("text-indent:${it / 20}pt;") }
                }
                if (content.isEmpty()) out.append("<p class=\"empty\"></p>") else out.append("<p style=\"$style\">$content</p>")
            }
        }
        out.append(boxes)
        boxes.setLength(0)
    }

    /** Runs, links and pictures inside a paragraph (or a part of one). */
    private fun inline(parent: Element, into: StringBuilder) {
        for (element in parent.elements()) {
            when (element.local) {
                "r" -> run(element, into)
                "hyperlink" -> {
                    val inner = StringBuilder()
                    inline(element, inner)
                    val href = element.rel("id")?.let { relationships[it] }?.takeIf { it.external }?.target?.let(HtmlPage::safeHref)
                    if (href != null) into.append("<a href=\"$href\">$inner</a>") else into.append(inner)
                }
                "ins", "smartTag", "customXml", "fldSimple", "bdo", "dir" -> inline(element, into)
                "sdt" -> element.child("sdtContent")?.let { inline(it, into) }
                "oMath", "oMathPara" -> into.append("<i>").append(escape(element.texts("t"))).append("</i>")
                "AlternateContent" -> element.chosen()?.let { inline(it, into) }
            }
        }
    }

    private fun run(r: Element, into: StringBuilder) {
        val text = StringBuilder()
        for (element in r.elements()) {
            when (element.local) {
                "t" -> text.append(escape(element.textContent))
                "tab", "ptab" -> text.append("&emsp;")
                "br", "cr" -> text.append(if (element.attr("type") == "page") "<hr class=\"page\">" else "<br>")
                "noBreakHyphen", "softHyphen" -> text.append("-")
                "drawing" -> drawing(element, text)
                "pict", "object" -> element.descendants("imagedata").forEach { image(it.rel("id"), null, text) }
                "AlternateContent" -> element.chosen()?.let { run(it, text) }
            }
        }
        if (text.isEmpty()) return
        val properties = r.child("rPr")
        if (properties == null) {
            into.append(text)
            return
        }
        val css = StringBuilder()
        HtmlPage.color(properties.path("color")?.attr("val"))?.let { css.append("color:$it;") }
        properties.path("sz")?.intAttr("val")?.let { css.append("font-size:${it / 2.0}pt;") }
        properties.path("highlight")?.attr("val")?.let { HIGHLIGHTS[it] }?.let { css.append("background:$it;") }
        HtmlPage.color(properties.path("shd")?.attr("fill"))?.let { css.append("background:$it;") }
        if (properties.child("caps").isOn()) css.append("text-transform:uppercase;")
        if (properties.child("smallCaps").isOn()) css.append("font-variant:small-caps;")
        val tags = ArrayList<String>()
        if (properties.child("b").isOn()) tags += "b"
        if (properties.child("i").isOn()) tags += "i"
        if (properties.child("u").isOn()) tags += "u"
        if (properties.child("strike").isOn() || properties.child("dstrike").isOn()) tags += "s"
        when (properties.path("vertAlign")?.attr("val")) {
            "superscript" -> tags += "sup"
            "subscript" -> tags += "sub"
        }
        if (css.isNotEmpty()) into.append("<span style=\"$css\">")
        tags.forEach { into.append("<$it>") }
        into.append(text)
        tags.asReversed().forEach { into.append("</$it>") }
        if (css.isNotEmpty()) into.append("</span>")
    }

    private fun drawing(drawing: Element, into: StringBuilder) {
        val extent = drawing.descendants("extent").firstOrNull()
        val width = extent?.longAttr("cx")?.let { it / EMU_PER_PT }
        drawing.descendants("blip").forEach { image(it.rel("embed"), width, into) }
        // A text box is its own little document, shown after the paragraph it sits in.
        drawing.descendants("txbxContent").firstOrNull()?.let { box ->
            val outer = boxes.toString()
            boxes.setLength(0)
            val saved = out.length
            blocks(box)
            val inner = out.substring(saved)
            out.setLength(saved)
            boxes.setLength(0)
            boxes.append(outer).append("<div class=\"box\">").append(inner).append("</div>")
        }
    }

    private fun image(id: String?, widthPt: Double?, into: StringBuilder) {
        val target = id?.let { relationships[it] }?.takeUnless { it.external }?.target ?: return
        val uri = pkg.imageDataUri(target) ?: return
        val style = widthPt?.let { " style=\"width:${String.format(Locale.ROOT, "%.0f", it)}pt\"" }.orEmpty()
        into.append("<img src=\"$uri\"$style alt=\"\">")
    }

    private fun table(tbl: Element) {
        // Place each cell on the grid first, so a vertically merged cell can count the rows it spans.
        val rows =
            tbl.children("tr").map { tr ->
                var column = 0
                tr.cells().map { tc ->
                    val properties = tc.child("tcPr")
                    val span = properties?.path("gridSpan")?.intAttr("val")?.coerceAtLeast(1) ?: 1
                    val merge = properties?.child("vMerge")
                    val cell = GridCell(tc, column, span, continues = merge != null && merge.attr("val") != "restart")
                    column += span
                    cell
                }
            }
        out.append("<table>")
        rows.forEachIndexed { index, row ->
            out.append("<tr>")
            for (cell in row) {
                if (cell.continues) continue
                var rowSpan = 1
                while (index + rowSpan < rows.size && rows[index + rowSpan].any { it.column == cell.column && it.continues }) rowSpan++
                val attributes = StringBuilder()
                if (cell.span > 1) attributes.append(" colspan=\"${cell.span}\"")
                if (rowSpan > 1) attributes.append(" rowspan=\"$rowSpan\"")
                HtmlPage.color(cell.element.path("tcPr", "shd")?.attr("fill"))?.let { attributes.append(" style=\"background:$it\"") }
                out.append("<td$attributes>")
                blocks(cell.element)
                out.append("</td>")
            }
            out.append("</tr>")
        }
        out.append("</table>")
    }

    /** A row's cells, including those wrapped in content controls. */
    private fun Element.cells(): List<Element> =
        elements().flatMap { element ->
            when (element.local) {
                "tc" -> listOf(element)
                "sdt" -> element.child("sdtContent")?.cells().orEmpty()
                else -> emptyList()
            }
        }

    private class GridCell(val element: Element, val column: Int, val span: Int, val continues: Boolean)

    /** Paragraph styles: which are headings, and which carry list numbering. */
    private class Styles(root: Element?) {
        private val byId = root?.children("style")?.associateBy { it.attr("styleId").orEmpty() }.orEmpty()

        fun headingLevel(styleId: String?, outline: Int?): Int? {
            if (outline != null && outline in 0..5) return outline + 1
            var id = styleId
            repeat(6) {
                val style = byId[id] ?: return null
                val name = style.path("name")?.attr("val")?.lowercase().orEmpty()
                when {
                    name == "title" -> return 1
                    name == "subtitle" -> return 2
                    name.startsWith("heading ") -> return name.removePrefix("heading ").toIntOrNull()?.coerceIn(1, 6)
                }
                style.path("pPr", "outlineLvl")?.intAttr("val")?.takeIf { it in 0..5 }?.let { return it + 1 }
                id = style.path("basedOn")?.attr("val")
            }
            return null
        }

        fun numPr(styleId: String?): Element? {
            var id = styleId
            repeat(6) {
                val style = byId[id] ?: return null
                style.path("pPr", "numPr")?.let { return it }
                id = style.path("basedOn")?.attr("val")
            }
            return null
        }
    }

    class ListLabel(val level: Int, val text: String)

    /** List numbering, counted as the document goes. */
    private class Numbering(root: Element?) {
        private val abstracts = root?.children("abstractNum")?.associateBy { it.attr("abstractNumId").orEmpty() }.orEmpty()
        private val instances = root?.children("num")?.associate { it.attr("numId").orEmpty() to it }.orEmpty()
        private val counters = HashMap<String, IntArray>()

        fun label(numPr: Element?): ListLabel? {
            val numId = numPr?.path("numId")?.attr("val") ?: return null
            if (numId == "0") return null
            val level = (numPr.path("ilvl")?.intAttr("val") ?: 0).coerceIn(0, 8)
            val instance = instances[numId]
            val abstract = abstracts[instance?.path("abstractNumId")?.attr("val")]
            val definitions = (0..8).map { l -> abstract?.children("lvl")?.firstOrNull { it.intAttr("ilvl") == l } }
            val definition = definitions[level]
            val format = definition?.path("numFmt")?.attr("val") ?: "bullet"
            val count = counters.getOrPut(numId) { IntArray(9) }
            val start = { l: Int -> definitions[l]?.path("start")?.intAttr("val") ?: 1 }
            count[level] = if (count[level] == 0) start(level) else count[level] + 1
            for (deeper in level + 1..8) count[deeper] = 0
            if (format == "bullet" || format == "none") return ListLabel(level, if (format == "none") "" else BULLETS[level % BULLETS.size])
            val pattern = definition?.path("lvlText")?.attr("val") ?: "%${level + 1}."
            val text =
                Regex("%([1-9])").replace(pattern) { match ->
                    val l = match.groupValues[1].toInt() - 1
                    val value = if (count[l] == 0) start(l) else count[l]
                    formatNumber(value, definitions[l]?.path("numFmt")?.attr("val") ?: "decimal")
                }
            return ListLabel(level, text)
        }
    }

    companion object {
        private const val EMU_PER_PT = 12_700.0
        private val BULLETS = listOf("•", "◦", "▪")
        private val HIGHLIGHTS =
            mapOf(
                "yellow" to "#ffff00", "green" to "#00ff00", "cyan" to "#00ffff", "magenta" to "#ff00ff",
                "blue" to "#0000ff", "red" to "#ff0000", "darkBlue" to "#000080", "darkCyan" to "#008080",
                "darkGreen" to "#008000", "darkMagenta" to "#800080", "darkRed" to "#800000", "darkYellow" to "#808000",
                "darkGray" to "#808080", "lightGray" to "#c0c0c0", "black" to "#000000",
            )

        private const val CSS =
            "article{padding:20px 18px 40px;font-size:15px}" +
                "p{margin:0 0 .6em}p.empty{min-height:1em}" +
                "h1,h2,h3,h4,h5,h6{margin:1em 0 .5em;line-height:1.25}h1{font-size:1.6em}h2{font-size:1.35em}h3{font-size:1.15em}h4,h5,h6{font-size:1em}" +
                ".li .n{display:inline-block;min-width:1.3em;padding-right:.3em;text-indent:0}" +
                "table{border-collapse:collapse;margin:.6em 0;max-width:100%;display:block;overflow-x:auto}" +
                "td{border:1px solid #c7c7cc;padding:4px 6px;vertical-align:top;min-width:2em}td p{margin:0 0 .2em}" +
                "hr.page{border:0;border-top:1px dashed #c7c7cc;margin:1.4em 0}" +
                ".box{display:block;border:1px solid #d1d1d6;padding:6px 8px;margin:.4em 0}"

        fun render(pkg: OoxmlPackage): String? {
            val main = pkg.relationships("").values.firstOrNull { it.type.endsWith("/officeDocument") }?.target ?: "word/document.xml"
            return DocxHtml(pkg, main).render()
        }

        internal fun formatNumber(value: Int, format: String): String =
            when (format) {
                "lowerLetter" -> letters(value).lowercase()
                "upperLetter" -> letters(value)
                "lowerRoman" -> roman(value).lowercase()
                "upperRoman" -> roman(value)
                "chineseCounting", "chineseCountingThousand", "ideographTraditional", "taiwaneseCounting" -> chinese(value)
                "decimalZero" -> value.toString().padStart(2, '0')
                else -> value.toString()
            }

        private fun letters(value: Int): String {
            if (value <= 0) return value.toString()
            val letter = 'A' + (value - 1) % 26
            return letter.toString().repeat((value - 1) / 26 + 1)
        }

        private fun roman(value: Int): String {
            if (value !in 1..3999) return value.toString()
            val numerals = listOf(1000 to "M", 900 to "CM", 500 to "D", 400 to "CD", 100 to "C", 90 to "XC", 50 to "L", 40 to "XL", 10 to "X", 9 to "IX", 5 to "V", 4 to "IV", 1 to "I")
            var left = value
            return buildString { for ((n, s) in numerals) while (left >= n) { append(s); left -= n } }
        }

        private fun chinese(value: Int): String {
            val digits = "〇一二三四五六七八九"
            if (value !in 1..99) return value.toString()
            if (value < 10) return digits[value].toString()
            val tens = value / 10
            val ones = value % 10
            return (if (tens == 1) "" else digits[tens].toString()) + "十" + (if (ones == 0) "" else digits[ones].toString())
        }
    }
}
