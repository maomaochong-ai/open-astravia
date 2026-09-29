package org.vetta.android.domain.work

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.vetta.android.domain.remote.connection.RemoteRequestException
import org.vetta.android.domain.remote.link.LinkChannel
import org.vetta.android.domain.remote.link.LinkOfflineException
import org.vetta.android.domain.remote.protocol.RemoteError
import org.vetta.android.domain.remote.protocol.RemoteErrorCode
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class FileViewingTest {
    @Test
    fun linksToWebPagesGoToTheSystemAndEverythingElseToTheDesktop() {
        assertEquals(ReplyLink.System, ReplyLink.classify("https://example.com/a"))
        assertEquals(ReplyLink.System, ReplyLink.classify("mailto:a@b.c"))
        assertEquals(ReplyLink.System, ReplyLink.classify("#heading"))
        assertEquals(ReplyLink.DesktopFile("docs/report.md"), ReplyLink.classify("docs/report.md"))
        assertEquals(ReplyLink.DesktopFile("/Users/me/a.txt"), ReplyLink.classify("/Users/me/a.txt"))
        assertEquals(ReplyLink.DesktopFile("file:///tmp/a.txt"), ReplyLink.classify("file:///tmp/a.txt"))
        assertEquals(ReplyLink.DesktopFile("C:/work/a.txt"), ReplyLink.classify("C:/work/a.txt"))
        assertEquals(ReplyLink.DesktopFile("~/notes.md"), ReplyLink.classify("~/notes.md"))
    }

    @Test
    fun choosesHowToShowAFile() {
        val text = "hello".encodeToByteArray()
        assertEquals(FilePreviewKind.Markdown, FilePreviewKind.of("README.MD", "text/markdown", text))
        assertEquals(FilePreviewKind.Html, FilePreviewKind.of("index.html", "text/html", text))
        assertEquals(FilePreviewKind.Image, FilePreviewKind.of("photo.heic", "image/jpeg", byteArrayOf(1, 0, 2)), "a scaled photo arrives as JPEG")
        assertEquals(FilePreviewKind.Text, FilePreviewKind.of("main.kt", "text/x-kotlin", text))
        assertEquals(FilePreviewKind.Unsupported, FilePreviewKind.of("app.bin", "application/octet-stream", byteArrayOf(1, 0, 2)))
        assertEquals(FilePreviewKind.Image, FilePreviewKind.of("shot.png", "application/octet-stream", byteArrayOf(1, 0, 2)), "known by its extension")
        assertEquals(FilePreviewKind.WebImage, FilePreviewKind.of("logo.svg", "image/svg+xml", "<svg/>".encodeToByteArray()), "SVG is drawn, not shown as text")
        assertEquals(FilePreviewKind.WebImage, FilePreviewKind.of("loading.GIF", "image/gif", byteArrayOf(71, 73, 70)), "a GIF keeps moving")
        assertEquals(FilePreviewKind.Audio, FilePreviewKind.of("memo.M4A", "application/octet-stream", byteArrayOf(1, 0, 2)))
        assertEquals(FilePreviewKind.Video, FilePreviewKind.of("demo.mov", "application/octet-stream", byteArrayOf(1, 0, 2)))
        assertEquals(FilePreviewKind.Pdf, FilePreviewKind.of("paper.PDF", "application/octet-stream", byteArrayOf(37, 80, 68, 70)))
        assertEquals(FilePreviewKind.Document, FilePreviewKind.of("plan.docx", "application/octet-stream", byteArrayOf(1, 0, 2)))
        assertEquals(FilePreviewKind.Document, FilePreviewKind.of("q3.XLSX", "application/octet-stream", byteArrayOf(1, 0, 2)))
        assertEquals(FilePreviewKind.Document, FilePreviewKind.of("deck.pptx", "application/octet-stream", byteArrayOf(1, 0, 2)))
        assertEquals(FilePreviewKind.Document, FilePreviewKind.of("data.csv", "text/csv", text), "a table, not text")
        assertEquals(FilePreviewKind.Unsupported, FilePreviewKind.of("old.doc", "application/octet-stream", byteArrayOf(1, 0, 2)), "the binary formats are handed on")
        assertEquals("", FileNames.parent("docs"))
        assertEquals("docs", FileNames.parent("docs/api/"))
        assertEquals("api", FileNames.title("docs/api", root = "vetta"))
        assertEquals("vetta", FileNames.title("", root = "vetta"))
    }

    @Test
    fun cutsLongTextIntoPiecesOfWholeLines() {
        val text = (1..5).joinToString("\n") { "line $it" }
        assertEquals(listOf("line 1\nline 2", "line 3\nline 4", "line 5"), FileText.chunks(text, lines = 2))
        assertEquals(listOf(""), FileText.chunks(""))
        assertEquals(listOf("abcd", "efgh", "ij"), FileText.chunks("abcdefghij", maxChars = 4), "a single long line is cut too")
        val big = (1..10_000).joinToString("\n") { "row $it" }
        assertEquals(big, FileText.chunks(big).joinToString("\n"), "nothing lost or added")
    }

    @Test
    fun sortsFilesIntoKindsForTheirIconsAndSaysWhenTryingAgainHelps() {
        assertEquals(FileCategory.Sheet, FileNames.category("Q3.XLSX"))
        assertEquals(FileCategory.Slides, FileNames.category("deck.pptx"))
        assertEquals(FileCategory.Pdf, FileNames.category("paper.pdf"))
        assertEquals(FileCategory.Image, FileNames.category("shot.png"))
        assertEquals(FileCategory.Code, FileNames.category("main.kt"))
        assertEquals(FileCategory.Code, FileNames.category("Makefile"))
        assertEquals(listOf(FileViewError.Offline, FileViewError.Failed), FileViewError.entries.filter { it.retryable })
    }

    @Test
    fun namesAFileForOtherAppsByWhatWasSent() {
        assertEquals("report.pdf", FileNames.exportName("report.pdf", "application/pdf"))
        assertEquals("IMG_1.jpg", FileNames.exportName("IMG_1.HEIC", "image/jpeg"), "a scaled photo is a JPEG")
        assertEquals("a.JPG", FileNames.exportName("a.JPG", "image/jpeg"))
        assertEquals("scan.jpg", FileNames.exportName("scan", "image/jpeg"))
        assertEquals(".._etc_passwd", FileNames.exportName("../etc/passwd", "text/plain"), "never outside its folder")
        assertEquals("file", FileNames.exportName("..", "text/plain"))
    }

    private fun chunk(bytes: ByteArray, offset: Int, total: Int, modifiedAt: Double = 7.0) =
        buildJsonObject {
            put("data", Base64.getEncoder().encodeToString(bytes))
            put("offset", offset)
            put("totalSize", total)
            put("modifiedAt", modifiedAt)
            put("mimeType", "text/plain")
        }

    @Test
    fun readsAFileChunkByChunkAndStartsOverWhenItChanges() =
        runTest {
            val content = ByteArray(10) { it.toByte() }
            val asked = mutableListOf<JsonObject>()
            var changedOnce = false
            val file =
                RemoteFileReader.read("a.txt", { 4 }) { payload ->
                    asked += payload
                    val offset = payload["offset"]!!.jsonPrimitive.int
                    if (offset == 4 && !changedOnce) {
                        changedOnce = true
                        throw RemoteRequestException(RemoteError(RemoteErrorCode.FileChanged, "changed", true))
                    }
                    chunk(content.copyOfRange(offset, minOf(offset + 4, 10)), offset, 10)
                }
            assertContentEquals(content, file.data)
            assertEquals("text/plain", file.mimeType)
            assertEquals(listOf(0, 4, 0, 4, 8), asked.map { it["offset"]!!.jsonPrimitive.int }, "the change at the second chunk starts it over")
            assertNull(asked.first()["modifiedAt"], "the first chunk says when the file was last changed")
            assertEquals(4, asked.first()["length"]!!.jsonPrimitive.int)
        }

    @Test
    fun refusesFilesTooLargeToPreviewAndExplainsFailures() =
        runTest {
            val error = assertFailsWith<FileViewException> { RemoteFileReader.read("big.bin", { null }) { chunk(ByteArray(1), 0, 20 * 1024 * 1024) } }
            assertEquals(FileViewError.TooLarge, error.reason)
            assertEquals(128 * 1024, RemoteFileReader.chunkBytes(LinkChannel.P2p))
            assertNull(RemoteFileReader.chunkBytes(LinkChannel.Relay))
            assertEquals(FileViewError.Forbidden, FileViewError.from(RemoteRequestException(RemoteError(RemoteErrorCode.Forbidden, "", false))))
            assertEquals(FileViewError.Offline, FileViewError.from(LinkOfflineException()))
            assertEquals(FileViewError.Failed, FileViewError.from(IllegalStateException()))
        }
}
