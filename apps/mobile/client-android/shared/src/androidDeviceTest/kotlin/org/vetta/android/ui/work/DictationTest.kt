package org.vetta.android.ui.work

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.runner.RunWith
import org.vetta.android.app.ThemeMode
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.resources.Res
import org.vetta.android.resources.chat_dictation_cancel
import org.vetta.android.resources.chat_dictation_denied
import org.vetta.android.resources.chat_dictation_hold
import org.vetta.android.ui.str
import org.vetta.android.ui.theme.VettaTheme
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@RunWith(AndroidJUnit4::class)
class DictationTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    /** Hears `script` as soon as it starts, like a recognizer that has already caught the words. */
    private class ScriptedDictation(private val script: String, private val failure: DictationFailure? = null) : Dictation {
        override var listening by mutableStateOf(false)
        override var transcript by mutableStateOf("")
        override var level by mutableFloatStateOf(0f)
        var started = 0

        override suspend fun start(): DictationFailure? {
            started += 1
            if (failure != null) return failure
            listening = true
            transcript = script
            level = 0.6f
            return null
        }

        override suspend fun stop(): String {
            listening = false
            return transcript
        }

        override fun cancel() {
            listening = false
            transcript = ""
        }
    }

    private fun setComposer(dictation: Dictation, initial: PromptDraft = PromptDraft()): () -> PromptDraft {
        var draft by mutableStateOf(initial)
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                Composer(draft, { draft = it }, placeholder = "", onSend = {}, dictation = dictation)
            }
        }
        return { draft }
    }

    /** Slides "Hold to talk" out under the field, as the voice button does. */
    private fun openVoice() {
        composeRule.onNodeWithTag("composer.voice").performClick()
        composeRule.waitForIdle()
    }

    @Test
    fun holdingHoldToTalkDictatesAndLettingGoFillsTheFieldWithoutSending() {
        val dictation = ScriptedDictation("帮我看看构建")
        var sent = 0
        var draft by mutableStateOf(PromptDraft("先"))
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                Composer(draft, { draft = it }, placeholder = "", onSend = { sent += 1 }, dictation = dictation)
            }
        }
        composeRule.onNodeWithTag("composer.hold").assertDoesNotExist()
        openVoice()
        composeRule.onNodeWithTag("composer.hold").assertIsDisplayed().assertContentDescriptionEquals(str(Res.string.chat_dictation_hold))
        composeRule.onNodeWithTag("composer.hold").performTouchInput {
            down(center)
            advanceEventTime(400)
        }
        composeRule.mainClock.advanceTimeBy(400)
        composeRule.onNodeWithTag("dictation.transcript", useUnmergedTree = true).assertExists()
        composeRule.onNodeWithText("帮我看看构建").assertExists()

        composeRule.onNodeWithTag("composer.hold").performTouchInput { up() }
        composeRule.waitForIdle()
        assertTrue(draft.text.endsWith("帮我看看构建"), "the words go in the field after what was typed")
        assertEquals(0, sent, "nothing goes to the desktop until Send")
        assertFalse(dictation.listening)
    }

    @Test
    fun slidingUpBeforeLettingGoThrowsTheWordsAway() {
        val dictation = ScriptedDictation("算了")
        val draft = setComposer(dictation)
        openVoice()
        composeRule.onNodeWithTag("composer.hold").performTouchInput {
            down(center)
            advanceEventTime(400)
        }
        composeRule.mainClock.advanceTimeBy(400)
        composeRule.onNodeWithTag("composer.hold").performTouchInput { moveBy(androidx.compose.ui.geometry.Offset(0f, -100f * density)) }
        composeRule.onNodeWithText(str(Res.string.chat_dictation_cancel)).assertExists()
        composeRule.onNodeWithTag("composer.hold").performTouchInput { up() }
        composeRule.waitForIdle()
        assertEquals("", draft().text)
    }

    @Test
    fun aQuickTapOnHoldToTalkHearsNothing() {
        val dictation = ScriptedDictation("不该出现")
        val draft = setComposer(dictation)
        openVoice()
        composeRule.onNodeWithTag("composer.hold").performTouchInput {
            down(center)
            advanceEventTime(50)
            up()
        }
        composeRule.waitForIdle()
        assertEquals(0, dictation.started)
        assertEquals("", draft().text)
    }

    @Test
    fun theKeyboardButtonPutsHoldToTalkAwayAndGoesBackToTyping() {
        setComposer(ScriptedDictation(""))
        openVoice()
        composeRule.onNodeWithTag("composer.hold").assertExists()
        composeRule.onNodeWithTag("composer.voice").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("composer.hold").assertDoesNotExist()
        composeRule.onNodeWithTag("composer.field").assertIsFocused()
    }

    @Test
    fun saysWhyDictationCannotStart() {
        val dictation = ScriptedDictation("", failure = DictationFailure.Denied)
        setComposer(dictation)
        openVoice()
        composeRule.onNodeWithTag("composer.hold").performTouchInput {
            down(center)
            advanceEventTime(400)
        }
        composeRule.mainClock.advanceTimeBy(400)
        composeRule.onNodeWithTag("composer.hold").performTouchInput { up() }
        composeRule.onNodeWithText(str(Res.string.chat_dictation_denied)).assertExists()
    }
}
