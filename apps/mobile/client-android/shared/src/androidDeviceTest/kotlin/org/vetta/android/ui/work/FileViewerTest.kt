package org.vetta.android.ui.work

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.runner.RunWith
import org.vetta.android.app.ThemeMode
import org.vetta.android.domain.remote.RemoteFileEntry
import org.vetta.android.domain.remote.RemoteFileInfo
import org.vetta.android.domain.work.FileContent
import org.vetta.android.domain.work.FileViewError
import org.vetta.android.domain.work.FileViewException
import org.vetta.android.resources.Res
import org.vetta.android.resources.files_error_forbidden
import org.vetta.android.resources.files_no_app
import org.vetta.android.ui.str
import org.vetta.android.ui.theme.VettaTheme
import kotlin.test.Test
import kotlin.test.assertEquals

@RunWith(AndroidJUnit4::class)
class FileViewerTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val source =
        object : FileSource {
            override suspend fun list(path: String): List<RemoteFileEntry> =
                if (path.isEmpty()) {
                    listOf(RemoteFileEntry("src", "src", true, 0, 0.0), RemoteFileEntry("notes.txt", "notes.txt", false, 12, 0.0))
                } else {
                    listOf(RemoteFileEntry("main.kt", "src/main.kt", false, 30, 0.0))
                }

            override suspend fun stat(href: String): RemoteFileInfo {
                if (href.startsWith("/etc")) throw FileViewException(FileViewError.Forbidden)
                return RemoteFileInfo("notes.txt", "notes.txt", false, 12, 1.0, "text/plain", "~/vetta/notes.txt")
            }

            override suspend fun read(info: RemoteFileInfo) = FileContent("记得写周报".encodeToByteArray(), "text/plain", 1.0)
        }

    @Test
    fun browsesFoldersAndOpensAFile() {
        val opened = mutableListOf<String>()
        composeRule.setContent { VettaTheme(ThemeMode.Light) { FilesPanel(source, onOpenFile = { opened += it }, onDismiss = {}) } }
        composeRule.onNodeWithTag("files.entry.src").performClick()
        composeRule.onNodeWithText("main.kt").assertExists()
        composeRule.onNodeWithTag("files.up").performClick()
        composeRule.onNodeWithTag("files.entry.notes.txt").performClick()
        assertEquals(listOf("notes.txt"), opened)
    }

    @Test
    fun previewsTextAndExplainsAFileItMayNotRead() {
        composeRule.setContent { VettaTheme(ThemeMode.Light) { FilePreviewScreen(source, "notes.txt", onDismiss = {}) } }
        composeRule.onNodeWithText("记得写周报").assertExists()
        composeRule.onNodeWithText("~/vetta/notes.txt").assertExists()
    }

    @Test
    fun saysWhyAFileCannotBeShown() {
        composeRule.setContent { VettaTheme(ThemeMode.Light) { FilePreviewScreen(source, "/etc/passwd", onDismiss = {}) } }
        composeRule.onNodeWithText(str(Res.string.files_error_forbidden)).assertExists()
    }

    @Test
    fun handsAFileItCannotShowToAnotherApp() {
        val binary =
            object : FileSource by source {
                override suspend fun stat(href: String) = RemoteFileInfo("model.bin", "model.bin", false, 3, 1.0, "application/octet-stream", "~/vetta/model.bin")

                override suspend fun read(info: RemoteFileInfo) = FileContent(byteArrayOf(1, 0, 2), "application/octet-stream", 1.0)
            }
        val handed = mutableListOf<String>()
        val export =
            object : FileExport {
                override suspend fun share(name: String, mimeType: String, data: ByteArray) {
                    handed += "share $name"
                }

                override suspend fun open(name: String, mimeType: String, data: ByteArray): Boolean {
                    handed += "open $name"
                    return false
                }
            }
        composeRule.setContent { VettaTheme(ThemeMode.Light) { FilePreviewScreen(binary, "model.bin", onDismiss = {}, export = export) } }
        composeRule.onNodeWithTag("files.unsupported.open").performClick()
        composeRule.onNodeWithText(str(Res.string.files_no_app)).assertExists()
        composeRule.onNodeWithTag("files.preview.share").performClick()
        composeRule.runOnIdle { assertEquals(listOf("open model.bin", "share model.bin"), handed) }
    }

    private fun single(name: String, bytes: ByteArray) =
        object : FileSource by source {
            override suspend fun stat(href: String) = RemoteFileInfo(name, name, false, bytes.size.toLong(), 1.0, "application/octet-stream", "~/vetta/$name")

            override suspend fun read(info: RemoteFileInfo) = FileContent(bytes, "application/octet-stream", 1.0)
        }

    @Test
    fun drawsATableAsAPageAndHandsOnADocumentItCannotRead() {
        var file by mutableStateOf(single("stock.csv", "名称,数量\n键盘,3\n".encodeToByteArray()))
        composeRule.setContent { VettaTheme(ThemeMode.Light) { key(file) { FilePreviewScreen(file, "x", onDismiss = {}) } } }
        composeRule.waitUntil(5_000) { composeRule.onAllNodesWithTag("files.html").fetchSemanticsNodes().isNotEmpty() }
        composeRule.onNodeWithTag("files.message").assertDoesNotExist()

        file = single("broken.docx", "not a zip".encodeToByteArray())
        composeRule.waitUntil(5_000) { composeRule.onAllNodesWithTag("files.unsupported.open").fetchSemanticsNodes().isNotEmpty() }
        composeRule.onNodeWithTag("files.html").assertDoesNotExist()
    }

    @Test
    fun showsAPictureItCanZoomAndDrawsAnSvg() {
        val png = java.util.Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
        var file by mutableStateOf(single("dot.png", png))
        composeRule.setContent { VettaTheme(ThemeMode.Light) { key(file) { FilePreviewScreen(file, "x", onDismiss = {}) } } }
        composeRule.waitUntil(5_000) { composeRule.onAllNodesWithTag("files.image").fetchSemanticsNodes().isNotEmpty() }

        file = single("logo.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"/>".encodeToByteArray())
        composeRule.waitUntil(5_000) { composeRule.onAllNodesWithTag("files.html").fetchSemanticsNodes().isNotEmpty() }
        composeRule.onNodeWithTag("files.text").assertDoesNotExist()
    }

    /** A small but real PDF: `pages` pages, each saying its number. */
    private fun pdf(pages: Int): ByteArray {
        val objects = ArrayList<String>()
        objects += "<< /Type /Catalog /Pages 2 0 R >>"
        objects += "<< /Type /Pages /Kids [${(0 until pages).joinToString(" ") { "${4 + it * 2} 0 R" }}] /Count $pages >>"
        objects += "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
        for (i in 1..pages) {
            val stream = "BT /F1 48 Tf 72 700 Td (Page $i) Tj ET"
            objects += "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + (i - 1) * 2} 0 R >>"
            objects += "<< /Length ${stream.length} >>\nstream\n$stream\nendstream"
        }
        val out = StringBuilder("%PDF-1.4\n")
        val offsets = objects.mapIndexed { i, body ->
            val at = out.length
            out.append("${i + 1} 0 obj\n$body\nendobj\n")
            at
        }
        val xref = out.length
        out.append("xref\n0 ${objects.size + 1}\n0000000000 65535 f \n")
        offsets.forEach { out.append(it.toString().padStart(10, '0')).append(" 00000 n \n") }
        out.append("trailer\n<< /Size ${objects.size + 1} /Root 1 0 R >>\nstartxref\n$xref\n%%EOF\n")
        return out.toString().encodeToByteArray()
    }

    @Test
    fun drawsAPdfPageByPageAndHandsOnOneItCannotOpen() {
        var file by mutableStateOf(single("paper.pdf", pdf(2)))
        composeRule.setContent { VettaTheme(ThemeMode.Light) { key(file) { FilePreviewScreen(file, "x", onDismiss = {}) } } }
        composeRule.waitUntil(5_000) { composeRule.onAllNodesWithText("1 / 2").fetchSemanticsNodes().isNotEmpty() }

        file = single("broken.pdf", "%PDF-1.4 nothing".encodeToByteArray())
        composeRule.waitUntil(5_000) { composeRule.onAllNodesWithTag("files.unsupported.open").fetchSemanticsNodes().isNotEmpty() }
    }

    @Test
    fun opensALongLogAtOnce() {
        val log = (1..150_000).joinToString("\n") { "2026-09-29 12:00:00 INFO request $it served" }
        composeRule.setContent { VettaTheme(ThemeMode.Light) { FilePreviewScreen(single("server.log", log.encodeToByteArray()), "x", onDismiss = {}) } }
        composeRule.waitUntil(3_000) { composeRule.onAllNodesWithText("request 1 served", substring = true).fetchSemanticsNodes().isNotEmpty() }
    }
}
