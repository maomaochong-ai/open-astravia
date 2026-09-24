package org.vetta.android.ui.work

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.runner.RunWith
import org.vetta.android.app.ThemeMode
import org.vetta.android.domain.remote.AttachmentKind
import org.vetta.android.domain.work.PromptAttachment
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.resources.Res
import org.vetta.android.resources.chat_attach_files
import org.vetta.android.resources.chat_attach_photos
import org.vetta.android.resources.chat_remove_attachment
import org.vetta.android.ui.str
import org.vetta.android.ui.theme.VettaTheme
import java.io.File
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@RunWith(AndroidJUnit4::class)
class AttachmentsTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun shrinksALargePhotoUntilOneUploadCarriesIt() {
        // Noise does not compress, so a 12 MP picture is far over the limit at any quality.
        val random = Random(7)
        val big = Bitmap.createBitmap(4000, 3000, Bitmap.Config.ARGB_8888)
        val pixels = IntArray(4000) { random.nextInt() or (0xFF shl 24) }
        for (y in 0 until 3000) big.setPixels(pixels.also { it.shuffle(random) }, 0, 4000, 0, y, 4000, 1)

        val jpeg = assertNotNull(ImageDownscaler.jpeg(big, PromptDraft.MAX_ATTACHMENT_BYTES))
        assertTrue(jpeg.size <= PromptDraft.MAX_ATTACHMENT_BYTES)
        val decoded = assertNotNull(BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size))
        assertEquals(4f / 3f, decoded.width.toFloat() / decoded.height, 0.01f, "the picture keeps its shape")

        val small = Bitmap.createBitmap(640, 480, Bitmap.Config.ARGB_8888)
        val kept = assertNotNull(ImageDownscaler.jpeg(small, PromptDraft.MAX_ATTACHMENT_BYTES))
        assertEquals(640, BitmapFactory.decodeByteArray(kept, 0, kept.size).width, "a picture that fits is not shrunk")
    }

    @Test
    fun takesFilesThatFitAndRefusesLargerOnes() {
        val fits = File(context.cacheDir, "notes.txt").apply { writeText("hello") }
        val tooBig = File(context.cacheDir, "big.bin").apply { writeBytes(ByteArray(PromptDraft.MAX_ATTACHMENT_BYTES + 1)) }
        try {
            val picked = assertIs<AttachmentPick.Picked>(AttachmentReader.read(context, Uri.fromFile(fits)))
            val attachment = picked.attachments.single()
            assertEquals(AttachmentKind.File, attachment.kind)
            assertEquals("notes.txt", attachment.name)
            assertEquals("hello", attachment.data.decodeToString())
            assertEquals(AttachmentPick.TooLarge("big.bin"), AttachmentReader.read(context, Uri.fromFile(tooBig)))
        } finally {
            fits.delete()
            tooBig.delete()
        }
    }

    @Test
    fun showsWhatIsAttachedLetsItBeRemovedAndOffersTheSources() {
        val photo = PromptAttachment(AttachmentKind.Image, "photo-1.jpg", "image/jpeg", byteArrayOf(1, 2, 3))
        val notes = PromptAttachment(AttachmentKind.File, "notes.txt", "text/plain", "hi".encodeToByteArray())
        var draft by mutableStateOf(PromptDraft("看看这些", listOf(photo, notes)))
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                Composer(draft, { draft = it }, placeholder = "", onSend = {})
            }
        }
        composeRule.onNodeWithText("notes.txt").assertIsDisplayed()
        composeRule.onNodeWithContentDescription(str(Res.string.chat_remove_attachment, "photo-1.jpg")).performClick()
        assertEquals(listOf("notes.txt"), draft.attachments.map { it.name })
        assertEquals("看看这些", draft.text, "removing an attachment keeps what was typed")

        composeRule.onNodeWithTag("composer.attach").performClick()
        composeRule.onNodeWithText(str(Res.string.chat_attach_photos)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.chat_attach_files)).assertIsDisplayed()
        composeRule.onNodeWithTag("attach.camera").assertIsDisplayed()
    }
}
