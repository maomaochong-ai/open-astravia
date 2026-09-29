package org.vetta.android.domain.work.documents

import org.w3c.dom.Element
import org.w3c.dom.Node
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.zip.ZipInputStream
import javax.xml.parsers.DocumentBuilderFactory

/*
 * Reading Office Open XML (docx, xlsx, pptx): a zip of XML parts tied together by
 * relationship files. Only what the previews need, with limits so a hostile file
 * cannot exhaust the phone.
 */

/** A relationship from one part to another, or to an outside address. */
internal data class Relationship(val target: String, val external: Boolean, val type: String)

internal class OoxmlPackage private constructor(private val parts: Map<String, ByteArray>) {
    fun has(name: String): Boolean = name in parts

    fun xml(name: String): Element? = parts[name]?.let(Xml::parse)

    /** The relationships of `part` by id; internal targets resolved to part names. */
    fun relationships(part: String): Map<String, Relationship> {
        val folder = part.substringBeforeLast('/', "")
        val file = part.substringAfterLast('/')
        val root = xml(if (folder.isEmpty()) "_rels/$file.rels" else "$folder/_rels/$file.rels") ?: return emptyMap()
        return root.children("Relationship").associate { rel ->
            val target = rel.attr("Target").orEmpty()
            val external = rel.attr("TargetMode") == "External"
            rel.attr("Id").orEmpty() to Relationship(if (external) target else resolve(folder, target), external, rel.attr("Type").orEmpty())
        }
    }

    /** The first relationship of `part` whose type ends with `type`. */
    fun related(part: String, type: String): String? = relationships(part).values.firstOrNull { !it.external && it.type.endsWith("/$type") }?.target

    /** An image part as a `data:` address a page can show, or null for a format browsers cannot draw (EMF, WMF). */
    fun imageDataUri(part: String): String? {
        val bytes = parts[part] ?: return null
        val type = IMAGE_TYPES[part.substringAfterLast('.').lowercase()] ?: return null
        return "data:$type;base64," + Base64.getEncoder().encodeToString(bytes)
    }

    companion object {
        private const val MAX_PARTS = 10_000
        private const val MAX_BYTES = 128L * 1024 * 1024
        private val IMAGE_TYPES =
            mapOf(
                "png" to "image/png",
                "jpg" to "image/jpeg",
                "jpeg" to "image/jpeg",
                "gif" to "image/gif",
                "bmp" to "image/bmp",
                "webp" to "image/webp",
                "svg" to "image/svg+xml",
            )

        /** Null when `data` is not a zip, or unpacks past the limits. */
        fun open(data: ByteArray): OoxmlPackage? {
            val parts = HashMap<String, ByteArray>()
            var total = 0L
            try {
                ZipInputStream(ByteArrayInputStream(data)).use { zip ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val entry = zip.nextEntry ?: break
                        if (entry.isDirectory) continue
                        if (parts.size >= MAX_PARTS) return null
                        val out = ByteArrayOutputStream()
                        while (true) {
                            val read = zip.read(buffer)
                            if (read < 0) break
                            total += read
                            if (total > MAX_BYTES) return null
                            out.write(buffer, 0, read)
                        }
                        parts[entry.name.removePrefix("/")] = out.toByteArray()
                    }
                }
            } catch (_: Exception) {
                return null
            }
            return if (parts.isEmpty()) null else OoxmlPackage(parts)
        }

        /** `target` relative to `folder`, as a part name. */
        fun resolve(folder: String, target: String): String {
            val path = target.substringBefore('#')
            val segments = ArrayDeque<String>()
            if (!path.startsWith("/")) folder.split('/').filter { it.isNotEmpty() }.forEach(segments::addLast)
            for (segment in path.split('/')) {
                when (segment) {
                    "", "." -> Unit
                    ".." -> segments.removeLastOrNull()
                    else -> segments.addLast(segment)
                }
            }
            return segments.joinToString("/")
        }
    }
}

internal object Xml {
    private val factory =
        DocumentBuilderFactory.newInstance().apply {
            isNamespaceAware = true
            isExpandEntityReferences = false
            // Office parts never declare a DOCTYPE; one is refused rather than resolved.
            runCatching { setFeature("http://apache.org/xml/features/disallow-doctype-decl", true) }
        }

    fun parse(bytes: ByteArray): Element? =
        try {
            synchronized(factory) { factory.newDocumentBuilder() }.parse(ByteArrayInputStream(bytes)).documentElement
        } catch (_: Exception) {
            null
        }
}

internal fun Element.elements(): List<Element> {
    val result = ArrayList<Element>()
    var node = firstChild
    while (node != null) {
        if (node.nodeType == Node.ELEMENT_NODE) result += node as Element
        node = node.nextSibling
    }
    return result
}

internal val Element.local: String get() = localName ?: nodeName.substringAfter(':')

internal fun Element.children(name: String): List<Element> = elements().filter { it.local == name }

internal fun Element.child(name: String): Element? = elements().firstOrNull { it.local == name }

/** Follows a chain of child names, e.g. `path("spPr", "xfrm", "off")`. */
internal fun Element.path(vararg names: String): Element? = names.fold(this as Element?) { at, name -> at?.child(name) }

internal fun Element.descendants(name: String): List<Element> {
    val result = ArrayList<Element>()
    fun walk(at: Element) {
        for (child in at.elements()) {
            if (child.local == name) result += child
            walk(child)
        }
    }
    walk(this)
    return result
}

/** An attribute by its local name, in no namespace or any. */
internal fun Element.attr(name: String): String? {
    val attributes = attributes
    for (i in 0 until attributes.length) {
        val node = attributes.item(i)
        if ((node.localName ?: node.nodeName.substringAfter(':')) == name && node.prefix != "xmlns") return node.nodeValue
    }
    return null
}

/** A relationship attribute (`r:id`, `r:embed`), told apart from a plain `id`. */
internal fun Element.rel(name: String): String? {
    val attributes = attributes
    for (i in 0 until attributes.length) {
        val node = attributes.item(i)
        if (node.localName == name && node.namespaceURI?.endsWith("relationships") == true) return node.nodeValue
    }
    return null
}

internal fun Element.intAttr(name: String): Int? = attr(name)?.toIntOrNull()

internal fun Element.longAttr(name: String): Long? = attr(name)?.toLongOrNull()

/** An on/off property (`<w:b/>`, `<w:b w:val="0"/>`, `b="1"`): present and not switched off. */
internal fun Element?.isOn(): Boolean = this != null && attr("val")?.lowercase() !in setOf("0", "false", "off", "none")

/** An `mc:AlternateContent`'s first choice, or its fallback when it has none. */
internal fun Element.chosen(): Element? = child("Choice") ?: child("Fallback")

/** The text of all `t` elements below, in order. */
internal fun Element.texts(name: String = "t"): String = descendants(name).joinToString("") { it.textContent }
