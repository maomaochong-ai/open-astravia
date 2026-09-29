package org.vetta.android.ui.work

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
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
}
