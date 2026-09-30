package org.vetta.android.domain.work.documents

import org.vetta.android.domain.work.documents.HtmlPage.escape
import org.w3c.dom.Element
import java.util.Locale
import kotlin.math.roundToInt

/**
 * A PowerPoint deck (.pptx) as a column of slides drawn to scale: text boxes and
 * placeholders where the layout puts them, with the sizes, colors, bullets and
 * alignment they inherit from the layout, master and theme; pictures, filled shapes,
 * lines, tables and backgrounds. Charts, SmartArt, animations and notes are left out.
 */
internal class PptxHtml private constructor(private val pkg: OoxmlPackage, presentation: String, root: Element) {
    private val width = root.child("sldSz")?.longAttr("cx")?.toDouble() ?: 9_144_000.0
    private val height = root.child("sldSz")?.longAttr("cy")?.toDouble() ?: 6_858_000.0
    private val defaultText = root.child("defaultTextStyle")
    private val slides = root.child("sldIdLst")?.children("sldId").orEmpty().mapNotNull { id -> id.rel("id")?.let { pkg.relationships(presentation)[it] }?.target }

    private fun render(): String {
        val body = StringBuilder()
        slides.forEachIndexed { index, part ->
            body.append("<figure>")
            slide(part, body)
            body.append("<figcaption>${index + 1} / ${slides.size}</figcaption></figure>")
        }
        val css = CSS + ".slide{height:calc(var(--w) * ${fmt(height / width)})}"
        return HtmlPage.page(css, body.toString())
    }

    /** A slide, layout or master: its XML and relationships. */
    private inner class Part(val name: String) {
        val root: Element? = pkg.xml(name)
        val relationships = pkg.relationships(name)
        val tree: Element? get() = root?.path("cSld", "spTree")

        fun related(type: String): Part? = relationships.values.firstOrNull { !it.external && it.type.endsWith("/$type") }?.let { Part(it.target) }

        fun image(id: String?): String? = id?.let { relationships[it] }?.takeUnless { it.external }?.target?.let(pkg::imageDataUri)
    }

    /** What a slide's shapes inherit: its layout, master and the theme's colors. */
    private inner class Context(val slide: Part) {
        val layout = slide.related("slideLayout")
        val master = layout?.related("slideMaster")
        private val scheme: Map<String, String> =
            master?.related("theme")?.root?.path("themeElements", "clrScheme")?.elements()?.associate { element ->
                val color = element.child("srgbClr")?.attr("val") ?: element.child("sysClr")?.let { it.attr("lastClr") ?: SYSTEM_COLORS[it.attr("val")] }
                element.local to (color ?: "000000")
            }.orEmpty()
        private val map: Map<String, String> =
            master?.root?.child("clrMap")?.let { clrMap -> listOf("bg1", "tx1", "bg2", "tx2").associateWith { clrMap.attr(it) ?: it } }.orEmpty()

        /** A color element's parent (`solidFill`, `fgClr`…) as CSS. */
        fun color(fill: Element?): String? {
            val element = fill?.elements()?.firstOrNull { it.local in COLOR_ELEMENTS } ?: return null
            val hex =
                when (element.local) {
                    "srgbClr" -> element.attr("val")
                    "schemeClr" -> element.attr("val")?.let { name -> scheme[map[name] ?: DEFAULT_MAP[name] ?: name] }
                    "sysClr" -> element.attr("lastClr") ?: SYSTEM_COLORS[element.attr("val")]
                    "prstClr" -> PRESET_COLORS[element.attr("val")]
                    "scrgbClr" -> null
                    else -> null
                } ?: return null
            return Colors.adjust(hex, element)
        }

        /** Placeholders on the layout, then the master, that a slide's placeholder takes its place and text style from. */
        fun inherited(ph: Element?): List<Element> {
            if (ph == null) return emptyList()
            val type = ph.attr("type") ?: "body"
            val idx = ph.attr("idx")
            val fromLayout = layout?.tree?.let { find(it, type, idx) }
            val masterType = when (type) { "ctrTitle" -> "title"; "subTitle", "obj" -> "body"; else -> type }
            val fromMaster = master?.tree?.let { find(it, masterType, null) }
            return listOfNotNull(fromLayout, fromMaster)
        }

        private fun find(tree: Element, type: String, idx: String?): Element? {
            val shapes = tree.descendants("sp")
            fun ph(shape: Element) = shape.path("nvSpPr", "nvPr", "ph")
            return (if (idx != null) shapes.firstOrNull { ph(it)?.attr("idx") == idx } else null)
                ?: shapes.firstOrNull { shape -> ph(shape)?.let { (it.attr("type") ?: "body") == type } == true }
        }

        /** The master's text style for a placeholder of this type. */
        fun masterStyle(ph: Element?): Element? {
            val styles = master?.root?.child("txStyles") ?: return null
            return when (ph?.attr("type") ?: if (ph != null) "body" else null) {
                "title", "ctrTitle" -> styles.child("titleStyle")
                "body", "subTitle", "obj" -> styles.child("bodyStyle")
                else -> styles.child("otherStyle")
            }
        }
    }

    private class Frame(val x: Double, val y: Double, val w: Double, val h: Double, val rotation: Double = 0.0, val flipH: Boolean = false, val flipV: Boolean = false)

    private fun frameOf(xfrm: Element?): Frame? {
        val off = xfrm?.child("off") ?: return null
        val ext = xfrm.child("ext") ?: return null
        return Frame(
            off.longAttr("x")?.toDouble() ?: 0.0,
            off.longAttr("y")?.toDouble() ?: 0.0,
            ext.longAttr("cx")?.toDouble() ?: 0.0,
            ext.longAttr("cy")?.toDouble() ?: 0.0,
            (xfrm.longAttr("rot") ?: 0L) / 60_000.0,
            xfrm.attr("flipH") == "1",
            xfrm.attr("flipV") == "1",
        )
    }

    private fun slide(name: String, out: StringBuilder) {
        val context = Context(Part(name))
        val background = background(context)
        out.append("<div class=\"slide\" style=\"$background\">")
        val layoutShowsMaster = context.layout?.root?.attr("showMasterSp") != "0"
        val slideShowsBehind = context.slide.root?.attr("showMasterSp") != "0"
        val identity: (Frame) -> Frame = { it }
        if (slideShowsBehind && layoutShowsMaster) context.master?.let { part -> part.tree?.let { shapes(it, part, context, identity, out, decorationOnly = true) } }
        if (slideShowsBehind) context.layout?.let { part -> part.tree?.let { shapes(it, part, context, identity, out, decorationOnly = true) } }
        context.slide.tree?.let { shapes(it, context.slide, context, identity, out, decorationOnly = false) }
        out.append("</div>")
    }

    private fun background(context: Context): String {
        for (part in listOfNotNull(context.slide, context.layout, context.master)) {
            val bg = part.root?.path("cSld", "bg") ?: continue
            bg.child("bgPr")?.let { pr ->
                fill(pr, part, context)?.let { return it }
            }
            bg.child("bgRef")?.let { ref -> context.color(ref)?.let { return "background:$it;" } }
        }
        return "background:#fff;"
    }

    /** A shape's fill as CSS, from `solidFill`, the first stop of a `gradFill`, or a picture. */
    private fun fill(properties: Element, part: Part, context: Context): String? {
        properties.child("solidFill")?.let { return context.color(it)?.let { color -> "background:$color;" } }
        properties.child("gradFill")?.let { grad ->
            val stops = grad.path("gsLst")?.children("gs").orEmpty().mapNotNull { stop -> context.color(stop)?.let { "$it ${(stop.intAttr("pos") ?: 0) / 1000}%" } }
            if (stops.size >= 2) return "background:linear-gradient(${90 + (grad.path("lin")?.longAttr("ang") ?: 0L) / 60_000}deg,${stops.joinToString(",")});"
            if (stops.isNotEmpty()) return "background:${stops.first().substringBefore(' ')};"
        }
        properties.child("blipFill")?.let { blip -> part.image(blip.child("blip")?.rel("embed"))?.let { return "background:url('$it') center/cover no-repeat;" } }
        if (properties.child("noFill") != null) return ""
        return null
    }

    private fun shapes(tree: Element, part: Part, context: Context, transform: (Frame) -> Frame, out: StringBuilder, decorationOnly: Boolean) {
        for (element in tree.elements()) {
            when (element.local) {
                "sp" -> {
                    if (decorationOnly && element.path("nvSpPr", "nvPr", "ph") != null) continue
                    shape(element, part, context, transform, out)
                }
                "pic" -> {
                    if (decorationOnly && element.path("nvPicPr", "nvPr", "ph") != null) continue
                    picture(element, part, context, transform, out)
                }
                "cxnSp" -> connector(element, context, transform, out)
                "graphicFrame" -> graphicFrame(element, part, context, transform, out)
                "grpSp" -> {
                    val xfrm = element.path("grpSpPr", "xfrm")
                    val frame = frameOf(xfrm)
                    val childOff = xfrm?.child("chOff")
                    val childExt = xfrm?.child("chExt")
                    val inner: (Frame) -> Frame =
                        if (frame == null || childOff == null || childExt == null) {
                            transform
                        } else {
                            val cx = childExt.longAttr("cx")?.toDouble()?.takeIf { it > 0 } ?: frame.w
                            val cy = childExt.longAttr("cy")?.toDouble()?.takeIf { it > 0 } ?: frame.h
                            val sx = frame.w / cx
                            val sy = frame.h / cy
                            val ox = childOff.longAttr("x")?.toDouble() ?: 0.0
                            val oy = childOff.longAttr("y")?.toDouble() ?: 0.0
                            { f: Frame -> transform(Frame(frame.x + (f.x - ox) * sx, frame.y + (f.y - oy) * sy, f.w * sx, f.h * sy, f.rotation, f.flipH, f.flipV)) }
                        }
                    shapes(element, part, context, inner, out, decorationOnly)
                }
                "AlternateContent" -> element.chosen()?.let { shapes(it, part, context, transform, out, decorationOnly) }
            }
        }
    }

    private fun shape(sp: Element, part: Part, context: Context, transform: (Frame) -> Frame, out: StringBuilder) {
        val ph = sp.path("nvSpPr", "nvPr", "ph")
        val inherited = if (part === context.slide) context.inherited(ph) else emptyList()
        val properties = sp.child("spPr")
        val frame = (frameOf(properties?.child("xfrm")) ?: inherited.firstNotNullOfOrNull { frameOf(it.path("spPr", "xfrm")) })?.let(transform) ?: return
        val css = StringBuilder(position(frame))
        val fill = properties?.let { fill(it, part, context) } ?: sp.path("style", "fillRef")?.takeIf { (it.intAttr("idx") ?: 0) > 0 }?.let { context.color(it)?.let { color -> "background:$color;" } }
        fill?.let(css::append)
        val line = properties?.child("ln")
        when {
            line?.child("noFill") != null -> Unit
            line?.child("solidFill") != null -> context.color(line.child("solidFill"))?.let { css.append("border:${lineWidth(line)} solid $it;") }
            line == null -> sp.path("style", "lnRef")?.takeIf { (it.intAttr("idx") ?: 0) > 0 }?.let { ref -> context.color(ref)?.let { css.append("border:${lineWidth(null)} solid $it;") } }
        }
        when (properties?.path("prstGeom")?.attr("prst")) {
            "ellipse" -> css.append("border-radius:50%;")
            "roundRect" -> css.append("border-radius:calc(var(--w) * ${fmt(minOf(frame.w, frame.h) * 0.16 / width)});")
        }
        val text = sp.child("txBody")?.let { body -> textBody(body, ph, inherited, context, part) }
        if (text.isNullOrEmpty() && fill.isNullOrEmpty() && !css.contains("border:")) return
        out.append("<div class=\"shape\" style=\"$css\">")
        text?.let(out::append)
        out.append("</div>")
    }

    private fun picture(pic: Element, part: Part, context: Context, transform: (Frame) -> Frame, out: StringBuilder) {
        val ph = pic.path("nvPicPr", "nvPr", "ph")
        val inherited = if (part === context.slide) context.inherited(ph) else emptyList()
        val frame = (frameOf(pic.path("spPr", "xfrm")) ?: inherited.firstNotNullOfOrNull { frameOf(it.path("spPr", "xfrm")) })?.let(transform) ?: return
        val uri = part.image(pic.path("blipFill", "blip")?.rel("embed")) ?: return
        out.append("<img class=\"shape\" src=\"$uri\" alt=\"\" style=\"${position(frame)}object-fit:fill\">")
    }

    private fun connector(cxn: Element, context: Context, transform: (Frame) -> Frame, out: StringBuilder) {
        val frame = frameOf(cxn.path("spPr", "xfrm"))?.let(transform) ?: return
        val line = cxn.path("spPr", "ln")
        if (line?.child("noFill") != null) return
        val color = context.color(line?.child("solidFill")) ?: context.color(cxn.path("style", "lnRef")) ?: "#000"
        val strokeWidth = ((line?.longAttr("w") ?: 12_700L) / 12_700.0).coerceAtLeast(0.75)
        val (x1, x2) = if (frame.flipH) "100%" to "0" else "0" to "100%"
        val (y1, y2) = if (frame.flipV) "100%" to "0" else "0" to "100%"
        val box = Frame(frame.x, frame.y, frame.w, frame.h)
        out.append("<svg class=\"shape\" style=\"${position(box)}overflow:visible\"><line x1=\"$x1\" y1=\"$y1\" x2=\"$x2\" y2=\"$y2\" stroke=\"$color\" stroke-width=\"${fmt(strokeWidth)}pt\" vector-effect=\"non-scaling-stroke\"/></svg>")
    }

    private fun graphicFrame(frameElement: Element, part: Part, context: Context, transform: (Frame) -> Frame, out: StringBuilder) {
        val frame = frameOf(frameElement.child("xfrm"))?.let(transform) ?: return
        val table = frameElement.path("graphic", "graphicData")?.child("tbl") ?: return
        out.append("<div class=\"shape\" style=\"${position(frame)}height:auto\"><table>")
        val widths = table.path("tblGrid")?.children("gridCol").orEmpty().map { it.longAttr("w")?.toDouble() ?: 0.0 }
        val total = widths.sum().takeIf { it > 0 } ?: 1.0
        out.append("<colgroup>")
        widths.forEach { out.append("<col style=\"width:${fmt(it * 100 / total)}%\">") }
        out.append("</colgroup>")
        for (tr in table.children("tr")) {
            out.append("<tr>")
            for (tc in tr.children("tc")) {
                if (tc.attr("hMerge") == "1" || tc.attr("vMerge") == "1") continue
                val attributes = StringBuilder()
                tc.intAttr("gridSpan")?.takeIf { it > 1 }?.let { attributes.append(" colspan=\"$it\"") }
                tc.intAttr("rowSpan")?.takeIf { it > 1 }?.let { attributes.append(" rowspan=\"$it\"") }
                context.color(tc.path("tcPr", "solidFill"))?.let { attributes.append(" style=\"background:$it\"") }
                out.append("<td$attributes>")
                tc.child("txBody")?.let { out.append(paragraphs(it, null, emptyList(), context, part)) }
                out.append("</td>")
            }
            out.append("</tr>")
        }
        out.append("</table></div>")
    }

    private fun textBody(body: Element, ph: Element?, inherited: List<Element>, context: Context, part: Part): String? {
        val content = paragraphs(body, ph, inherited, context, part)
        if (content.isEmpty()) return null
        val bodyPr = body.child("bodyPr")
        val inheritedBodyPr = inherited.mapNotNull { it.path("txBody", "bodyPr") }
        fun bodyAttr(name: String): String? = bodyPr?.attr(name) ?: inheritedBodyPr.firstNotNullOfOrNull { it.attr(name) }
        val css = StringBuilder()
        val inset = { name: String, default: Long -> "calc(var(--w) * ${fmt((bodyAttr(name)?.toLongOrNull() ?: default) / width)})" }
        css.append("padding:${inset("tIns", 45_720)} ${inset("rIns", 91_440)} ${inset("bIns", 45_720)} ${inset("lIns", 91_440)};")
        css.append(
            when (bodyAttr("anchor")) {
                "ctr" -> "justify-content:center;"
                "b" -> "justify-content:flex-end;"
                else -> "justify-content:flex-start;"
            },
        )
        if (bodyAttr("wrap") == "none") css.append("white-space:nowrap;")
        if (bodyAttr("vert")?.let { it != "horz" } == true) css.append("writing-mode:vertical-rl;")
        return "<div class=\"text\" style=\"$css\">$content</div>"
    }

    /** The paragraphs of a text body; `ph` and `inherited` say which styles its text falls back to. */
    private fun paragraphs(body: Element, ph: Element?, inherited: List<Element>, context: Context, part: Part): String {
        val out = StringBuilder()
        val autofit = body.path("bodyPr", "normAutofit")
        val scale = (autofit?.intAttr("fontScale") ?: 100_000) / 100_000.0
        val levels =
            listOfNotNull(body.child("lstStyle")) +
                inherited.mapNotNull { it.path("txBody", "lstStyle") } +
                listOfNotNull(context.masterStyle(ph), defaultText)
        val bulleted = ph != null && (ph.attr("type") ?: "body") in setOf("body", "obj")
        var number = 0
        var any = false
        for (p in body.children("p")) {
            val properties = p.child("pPr")
            val level = (properties?.intAttr("lvl") ?: 0).coerceIn(0, 8)
            val styles = listOfNotNull(properties) + levels.mapNotNull { it.child("lvl${level + 1}pPr") }
            fun attr(name: String): String? = styles.firstNotNullOfOrNull { it.attr(name) }
            fun child(name: String): Element? = styles.firstNotNullOfOrNull { it.child(name) }
            val defaults = styles.mapNotNull { it.child("defRPr") }
            val runs = StringBuilder()
            var firstSize: Double? = null
            for (r in p.elements()) {
                when (r.local) {
                    "r", "fld" -> {
                        val text = r.child("t")?.textContent ?: continue
                        val run = run(text, r.child("rPr"), defaults, scale, context, part)
                        if (firstSize == null) firstSize = run.second
                        runs.append(run.first)
                    }
                    "br" -> runs.append("<br>")
                }
            }
            val size = firstSize ?: size(p.child("endParaRPr"), defaults, scale)
            val css = StringBuilder("font-size:${fontSize(size)};")
            when (attr("algn")) {
                "ctr" -> css.append("text-align:center;")
                "r" -> css.append("text-align:right;")
                "just", "dist" -> css.append("text-align:justify;")
            }
            val marginLeft = attr("marL")?.toLongOrNull() ?: 0L
            val indent = attr("indent")?.toLongOrNull() ?: 0L
            if (marginLeft != 0L) css.append("margin-left:calc(var(--w) * ${fmt(marginLeft / width)});")
            if (indent != 0L) css.append("text-indent:calc(var(--w) * ${fmt(indent / width)});")
            child("spcBef")?.path("spcPts")?.intAttr("val")?.let { css.append("margin-top:${fontSize(it / 100.0 * scale)};") }
            child("lnSpc")?.path("spcPct")?.intAttr("val")?.let { css.append("line-height:${fmt(it / 100_000.0 * 1.2)};") }
            val bullet =
                when {
                    runs.isEmpty() -> null
                    properties?.child("buNone") != null -> null
                    child("buAutoNum") != null -> {
                        number++
                        autoNumber(number, child("buAutoNum")?.attr("type"))
                    }
                    child("buNone") != null && properties?.child("buChar") == null -> null
                    child("buChar") != null -> child("buChar")?.attr("char")?.let { if (it.length == 1 && it[0].code in 0xF000..0xF0FF) "•" else it }
                    bulleted -> "•"
                    else -> null
                }
            if (bullet != null) runs.insert(0, "<span class=\"bu\">${escape(bullet)}</span>")
            if (runs.isNotEmpty()) any = true
            out.append("<p style=\"$css\">").append(if (runs.isEmpty()) "&#8203;" else runs).append("</p>")
        }
        return if (any) out.toString() else ""
    }

    /** A run as HTML, and its size in points. */
    private fun run(text: String, properties: Element?, defaults: List<Element>, scale: Double, context: Context, part: Part): Pair<String, Double> {
        val all = listOfNotNull(properties) + defaults
        fun attr(name: String) = all.firstNotNullOfOrNull { it.attr(name) }
        val size = size(properties, defaults, scale)
        val css = StringBuilder("font-size:${fontSize(size)};")
        all.firstNotNullOfOrNull { it.child("solidFill") }?.let { context.color(it) }?.let { css.append("color:$it;") }
        if (attr("b") == "1") css.append("font-weight:bold;")
        if (attr("i") == "1") css.append("font-style:italic;")
        val decorations = listOfNotNull(attr("u")?.takeIf { it != "none" }?.let { "underline" }, attr("strike")?.takeIf { it != "noStrike" }?.let { "line-through" })
        if (decorations.isNotEmpty()) css.append("text-decoration:${decorations.joinToString(" ")};")
        attr("baseline")?.toIntOrNull()?.takeIf { it != 0 }?.let { css.append("vertical-align:${if (it > 0) "super" else "sub"};font-size:${fontSize(size * 0.7)};") }
        if (attr("cap") == "all") css.append("text-transform:uppercase;")
        val html = "<span style=\"$css\">${escape(text)}</span>"
        val href = properties?.child("hlinkClick")?.rel("id")?.let { part.relationships[it] }?.takeIf { it.external }?.target?.let(HtmlPage::safeHref)
        return (if (href != null) "<a href=\"$href\">$html</a>" else html) to size
    }

    private fun size(properties: Element?, defaults: List<Element>, scale: Double): Double =
        ((listOfNotNull(properties) + defaults).firstNotNullOfOrNull { it.intAttr("sz") } ?: 1800) / 100.0 * scale

    private fun fontSize(points: Double) = "calc(var(--w) * ${fmt(points * EMU_PER_PT / width)})"

    private fun lineWidth(line: Element?): String = "max(1px, calc(var(--w) * ${fmt((line?.longAttr("w") ?: 12_700L) / width)}))"

    private fun position(frame: Frame): String {
        val css = StringBuilder()
        css.append("left:${fmt(frame.x * 100 / width)}%;top:${fmt(frame.y * 100 / height)}%;")
        css.append("width:${fmt(frame.w * 100 / width)}%;height:${fmt(frame.h * 100 / height)}%;")
        val transforms = ArrayList<String>()
        if (frame.rotation != 0.0) transforms += "rotate(${fmt(frame.rotation)}deg)"
        if (frame.flipH) transforms += "scaleX(-1)"
        if (frame.flipV) transforms += "scaleY(-1)"
        if (transforms.isNotEmpty()) css.append("transform:${transforms.joinToString(" ")};")
        return css.toString()
    }

    companion object {
        private const val EMU_PER_PT = 12_700.0
        private val COLOR_ELEMENTS = setOf("srgbClr", "schemeClr", "sysClr", "prstClr", "scrgbClr")
        private val DEFAULT_MAP = mapOf("bg1" to "lt1", "tx1" to "dk1", "bg2" to "lt2", "tx2" to "dk2")
        private val SYSTEM_COLORS = mapOf("windowText" to "000000", "window" to "FFFFFF")
        private val PRESET_COLORS =
            mapOf("black" to "000000", "white" to "FFFFFF", "red" to "FF0000", "green" to "008000", "blue" to "0000FF", "yellow" to "FFFF00", "gray" to "808080", "orange" to "FFA500")

        private const val CSS =
            "body{background:#e5e5ea;padding:12px 0}" +
                ":root{--w:calc(100vw - 24px)}" +
                "figure{margin:0 12px 16px}" +
                "figcaption{text-align:center;color:#6e6e73;font-size:12px;margin-top:6px}" +
                ".slide{position:relative;width:var(--w);overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.18);line-height:1.2}" +
                ".shape{position:absolute;box-sizing:border-box;margin:0}" +
                ".text{display:flex;flex-direction:column;width:100%;height:100%;box-sizing:border-box;overflow:visible}" +
                ".text p{margin:0}" +
                ".bu{display:inline-block;min-width:1.1em}" +
                ".shape table{width:100%;border-collapse:collapse}" +
                ".shape td{border:1px solid #bbb;padding:.2em .4em;vertical-align:top}"

        fun render(pkg: OoxmlPackage): String? {
            val presentation = pkg.relationships("").values.firstOrNull { it.type.endsWith("/officeDocument") }?.target ?: "ppt/presentation.xml"
            val root = pkg.xml(presentation) ?: return null
            return PptxHtml(pkg, presentation, root).render()
        }

        private fun fmt(value: Double): String = String.format(Locale.ROOT, "%.5f", value).trimEnd('0').trimEnd('.')

        private fun autoNumber(n: Int, type: String?): String =
            when {
                type == null -> "$n."
                type.startsWith("alphaLc") -> DocxHtml.formatNumber(n, "lowerLetter") + suffix(type)
                type.startsWith("alphaUc") -> DocxHtml.formatNumber(n, "upperLetter") + suffix(type)
                type.startsWith("romanLc") -> DocxHtml.formatNumber(n, "lowerRoman") + suffix(type)
                type.startsWith("romanUc") -> DocxHtml.formatNumber(n, "upperRoman") + suffix(type)
                else -> "$n" + suffix(type)
            }

        private fun suffix(type: String): String =
            when {
                type.endsWith("ParenBoth") -> ")"
                type.endsWith("ParenR") -> ")"
                type.endsWith("Period") -> "."
                else -> ""
            }
    }
}

/** DrawingML color adjustments: luminance, shade, tint and transparency. */
internal object Colors {
    fun adjust(hex: String, element: Element): String? {
        if (hex.length != 6) return null
        var r = hex.substring(0, 2).toInt(16) / 255.0
        var g = hex.substring(2, 4).toInt(16) / 255.0
        var b = hex.substring(4, 6).toInt(16) / 255.0
        var alpha = 1.0
        for (mod in element.elements()) {
            val value = (mod.intAttr("val") ?: continue) / 100_000.0
            when (mod.local) {
                "lumMod", "lumOff" -> {
                    val hsl = toHsl(r, g, b)
                    val l = if (mod.local == "lumMod") hsl[2] * value else hsl[2] + value
                    val rgb = fromHsl(hsl[0], hsl[1], l.coerceIn(0.0, 1.0))
                    r = rgb[0]
                    g = rgb[1]
                    b = rgb[2]
                }
                "shade" -> {
                    r *= value
                    g *= value
                    b *= value
                }
                "tint" -> {
                    r += (1 - r) * (1 - value)
                    g += (1 - g) * (1 - value)
                    b += (1 - b) * (1 - value)
                }
                "alpha" -> alpha = value
            }
        }
        val channels = listOf(r, g, b).map { (it.coerceIn(0.0, 1.0) * 255).roundToInt() }
        return if (alpha < 1.0) {
            "rgba(${channels.joinToString(",")},${String.format(Locale.ROOT, "%.2f", alpha)})"
        } else {
            "#" + channels.joinToString("") { it.toString(16).padStart(2, '0') }
        }
    }

    private fun toHsl(r: Double, g: Double, b: Double): DoubleArray {
        val max = maxOf(r, g, b)
        val min = minOf(r, g, b)
        val l = (max + min) / 2
        if (max == min) return doubleArrayOf(0.0, 0.0, l)
        val d = max - min
        val s = if (l > 0.5) d / (2 - max - min) else d / (max + min)
        val h =
            when (max) {
                r -> (g - b) / d + (if (g < b) 6 else 0)
                g -> (b - r) / d + 2
                else -> (r - g) / d + 4
            } / 6
        return doubleArrayOf(h, s, l)
    }

    private fun fromHsl(h: Double, s: Double, l: Double): DoubleArray {
        if (s == 0.0) return doubleArrayOf(l, l, l)
        val q = if (l < 0.5) l * (1 + s) else l + s - l * s
        val p = 2 * l - q
        fun hue(t0: Double): Double {
            var t = t0
            if (t < 0) t += 1
            if (t > 1) t -= 1
            return when {
                t < 1.0 / 6 -> p + (q - p) * 6 * t
                t < 1.0 / 2 -> q
                t < 2.0 / 3 -> p + (q - p) * (2.0 / 3 - t) * 6
                else -> p
            }
        }
        return doubleArrayOf(hue(h + 1.0 / 3), hue(h), hue(h - 1.0 / 3))
    }
}
