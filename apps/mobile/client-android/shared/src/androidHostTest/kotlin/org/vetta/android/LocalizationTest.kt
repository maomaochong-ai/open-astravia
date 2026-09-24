package org.vetta.android

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Every user-visible string ships in English (the fallback) and Simplified Chinese;
 * a key missing from one file would show the other language or crash on lookup.
 */
class LocalizationTest {
    private val resources = File("src/commonMain/composeResources")
    private val english = read("values")
    private val chinese = read("values-zh-rCN")

    @Test
    fun bothLanguagesHaveTheSameKeys() {
        assertEquals(emptySet(), english.keys - chinese.keys, "missing from values-zh-rCN")
        assertEquals(emptySet(), chinese.keys - english.keys, "missing from values")
    }

    @Test
    fun noStringIsBlank() {
        val blank = (english + chinese.mapKeys { "zh:${it.key}" }).filterValues { it.isBlank() }.keys
        assertTrue(blank.isEmpty(), "blank strings: $blank")
    }

    @Test
    fun bothLanguagesTakeTheSameFormatArguments() {
        val mismatched =
            english.keys.filter { key ->
                chinese[key] != null && placeholders(english.getValue(key)) != placeholders(chinese.getValue(key))
            }
        assertTrue(mismatched.isEmpty(), "format arguments differ: $mismatched")
    }

    /** Strings by name; a plural counts as its `other` form, which every language has. */
    private fun read(folder: String): Map<String, String> {
        val file = File(resources, "$folder/strings.xml")
        assertTrue(file.isFile, "missing $file")
        val document = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file)
        val strings = document.getElementsByTagName("string")
        val plurals = document.getElementsByTagName("plurals")
        return (0 until strings.length).associate { index ->
            val element = strings.item(index) as Element
            element.getAttribute("name") to element.textContent
        } +
            (0 until plurals.length).associate { index ->
                val element = plurals.item(index) as Element
                val items = element.getElementsByTagName("item")
                val other = (0 until items.length).map { items.item(it) as Element }.firstOrNull { it.getAttribute("quantity") == "other" }
                "plural:${element.getAttribute("name")}" to other?.textContent.orEmpty()
            }
    }

    private fun placeholders(text: String): List<String> =
        PLACEHOLDER.findAll(text).map { it.value }.sorted().toList()

    private companion object {
        val PLACEHOLDER = Regex("%\\d+\\$[sd]")
    }
}
