package org.vetta.android.domain.markdown

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class MarkdownParserTest {
    @Test
    fun parsesPlainParagraph() {
        val blocks = MarkdownParser.parse("hello world")
        val p = assertIs<MdBlock.Paragraph>(blocks.single())
        assertEquals(listOf(MdInline.Text("hello world")), p.inlines)
    }

    @Test
    fun parsesBoldAndList() {
        val source =
            """
            **bold** text
            - one
            - two
            """.trimIndent()
        val blocks = MarkdownParser.parse(source)
        assertTrue(blocks.any { it is MdBlock.Paragraph })
        val list = blocks.filterIsInstance<MdBlock.BulletList>().single()
        assertEquals(2, list.items.size)
        val para = blocks.filterIsInstance<MdBlock.Paragraph>().first()
        assertTrue(para.inlines.any { it is MdInline.Bold && it.text == "bold" })
    }

    @Test
    fun parsesFencedKotlinCodeBlock() {
        val source =
            """
            intro
            ```kotlin
            fun main() {
              println("hi")
            }
            ```
            tail
            """.trimIndent()
        val blocks = MarkdownParser.parse(source)
        val code = blocks.filterIsInstance<MdBlock.CodeBlock>().single()
        assertEquals("kotlin", code.language)
        assertTrue(code.code.contains("fun main()"))
        assertTrue(code.code.contains("println(\"hi\")"))
        // copyable body is exact fenced interior
        assertEquals(
            """
            fun main() {
              println("hi")
            }
            """.trimIndent(),
            code.code,
        )
        assertTrue(blocks.any { it is MdBlock.Paragraph && it.inlines.any { i -> i is MdInline.Text && i.text.contains("intro") } })
    }

    @Test
    fun parsesHeading() {
        val blocks = MarkdownParser.parse("## Title")
        val h = assertIs<MdBlock.Heading>(blocks.single())
        assertEquals(2, h.level)
        assertEquals("Title", (h.inlines.single() as MdInline.Text).text)
    }
}
