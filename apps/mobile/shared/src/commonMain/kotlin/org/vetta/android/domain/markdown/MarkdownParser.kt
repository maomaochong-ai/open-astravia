package org.vetta.android.domain.markdown

/**
 * 轻量 Markdown 解析：标题 / 段落 / 列表 / 围栏代码块 / 常见行内样式。
 * 有意不做完整 CommonMark；覆盖聊天助手输出的高频子集。
 */
object MarkdownParser {
    fun parse(source: String): List<MdBlock> {
        if (source.isEmpty()) return emptyList()
        val lines = source.replace("\r\n", "\n").replace('\r', '\n').split('\n')
        val blocks = mutableListOf<MdBlock>()
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            when {
                line.trimStart().startsWith("```") -> {
                    val lang = line.trimStart().removePrefix("```").trim().ifBlank { null }
                    val codeLines = mutableListOf<String>()
                    i++
                    while (i < lines.size && !lines[i].trimStart().startsWith("```")) {
                        codeLines.add(lines[i])
                        i++
                    }
                    if (i < lines.size && lines[i].trimStart().startsWith("```")) {
                        i++
                    }
                    blocks.add(MdBlock.CodeBlock(language = lang, code = codeLines.joinToString("\n")))
                }
                headingLevel(line) != null -> {
                    val level = headingLevel(line)!!
                    val text = line.trimStart().dropWhile { it == '#' }.trimStart()
                    blocks.add(MdBlock.Heading(level = level, inlines = parseInlines(text)))
                    i++
                }
                bulletItem(line) != null -> {
                    val items = mutableListOf<List<MdInline>>()
                    while (i < lines.size) {
                        val item = bulletItem(lines[i]) ?: break
                        items.add(parseInlines(item))
                        i++
                    }
                    blocks.add(MdBlock.BulletList(items))
                }
                orderedItem(line) != null -> {
                    val items = mutableListOf<List<MdInline>>()
                    while (i < lines.size) {
                        val item = orderedItem(lines[i]) ?: break
                        items.add(parseInlines(item))
                        i++
                    }
                    blocks.add(MdBlock.OrderedList(items))
                }
                line.isBlank() -> {
                    i++
                }
                else -> {
                    val para = mutableListOf<String>()
                    while (
                        i < lines.size &&
                        lines[i].isNotBlank() &&
                        headingLevel(lines[i]) == null &&
                        bulletItem(lines[i]) == null &&
                        orderedItem(lines[i]) == null &&
                        !lines[i].trimStart().startsWith("```")
                    ) {
                        para.add(lines[i])
                        i++
                    }
                    blocks.add(MdBlock.Paragraph(inlines = parseInlines(para.joinToString(" "))))
                }
            }
        }
        return blocks
    }

    fun parseInlines(text: String): List<MdInline> {
        if (text.isEmpty()) return emptyList()
        val result = mutableListOf<MdInline>()
        var i = 0
        val buf = StringBuilder()

        fun flushText() {
            if (buf.isNotEmpty()) {
                result.add(MdInline.Text(buf.toString()))
                buf.clear()
            }
        }

        while (i < text.length) {
            when {
                text.startsWith("**", i) -> {
                    val end = text.indexOf("**", i + 2)
                    if (end > i + 2) {
                        flushText()
                        result.add(MdInline.Bold(text.substring(i + 2, end)))
                        i = end + 2
                    } else {
                        buf.append(text[i])
                        i++
                    }
                }
                text.startsWith("`", i) && !text.startsWith("```", i) -> {
                    val end = text.indexOf('`', i + 1)
                    if (end > i + 1) {
                        flushText()
                        result.add(MdInline.Code(text.substring(i + 1, end)))
                        i = end + 1
                    } else {
                        buf.append(text[i])
                        i++
                    }
                }
                text.startsWith("[", i) -> {
                    val closeLabel = text.indexOf(']', i + 1)
                    if (closeLabel > i + 1 && closeLabel + 1 < text.length && text[closeLabel + 1] == '(') {
                        val closeUrl = text.indexOf(')', closeLabel + 2)
                        if (closeUrl > closeLabel + 2) {
                            flushText()
                            result.add(
                                MdInline.Link(
                                    text = text.substring(i + 1, closeLabel),
                                    url = text.substring(closeLabel + 2, closeUrl),
                                ),
                            )
                            i = closeUrl + 1
                        } else {
                            buf.append(text[i])
                            i++
                        }
                    } else {
                        buf.append(text[i])
                        i++
                    }
                }
                text.startsWith("*", i) && !text.startsWith("**", i) -> {
                    val end = text.indexOf('*', i + 1)
                    if (end > i + 1) {
                        flushText()
                        result.add(MdInline.Italic(text.substring(i + 1, end)))
                        i = end + 1
                    } else {
                        buf.append(text[i])
                        i++
                    }
                }
                text.startsWith("_", i) -> {
                    val end = text.indexOf('_', i + 1)
                    if (end > i + 1) {
                        flushText()
                        result.add(MdInline.Italic(text.substring(i + 1, end)))
                        i = end + 1
                    } else {
                        buf.append(text[i])
                        i++
                    }
                }
                else -> {
                    buf.append(text[i])
                    i++
                }
            }
        }
        flushText()
        return result
    }

    private fun headingLevel(line: String): Int? {
        val t = line.trimStart()
        if (!t.startsWith("#")) return null
        var n = 0
        while (n < t.length && t[n] == '#') n++
        if (n !in 1..6) return null
        if (n < t.length && t[n] != ' ') return null
        return n
    }

    private fun bulletItem(line: String): String? {
        val t = line.trimStart()
        return when {
            t.startsWith("- ") -> t.removePrefix("- ")
            t.startsWith("* ") -> t.removePrefix("* ")
            t.startsWith("+ ") -> t.removePrefix("+ ")
            else -> null
        }
    }

    private fun orderedItem(line: String): String? {
        val t = line.trimStart()
        var i = 0
        while (i < t.length && t[i].isDigit()) i++
        if (i == 0) return null
        if (i >= t.length || t[i] != '.') return null
        if (i + 1 >= t.length || t[i + 1] != ' ') return null
        return t.substring(i + 2)
    }
}
