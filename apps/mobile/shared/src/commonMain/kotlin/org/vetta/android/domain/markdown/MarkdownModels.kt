package org.vetta.android.domain.markdown

/**
 * 纯数据 Markdown 块模型。UI 与解析解耦，便于单元测试驱动真实 [MarkdownParser]。
 */
sealed class MdBlock {
    data class Heading(
        val level: Int,
        val inlines: List<MdInline>,
    ) : MdBlock()

    data class Paragraph(
        val inlines: List<MdInline>,
    ) : MdBlock()

    data class BulletList(
        val items: List<List<MdInline>>,
    ) : MdBlock()

    data class OrderedList(
        val items: List<List<MdInline>>,
    ) : MdBlock()

    data class CodeBlock(
        val language: String?,
        val code: String,
    ) : MdBlock()
}

sealed class MdInline {
    data class Text(val text: String) : MdInline()

    data class Bold(val text: String) : MdInline()

    data class Italic(val text: String) : MdInline()

    data class Code(val text: String) : MdInline()

    data class Link(
        val text: String,
        val url: String,
    ) : MdInline()
}
