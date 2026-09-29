package org.vetta.android.ui.work

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.runner.RunWith
import org.vetta.android.app.ThemeMode
import org.vetta.android.domain.remote.RemoteSkillOption
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.domain.work.SkillCatalog
import org.vetta.android.ui.theme.VettaTheme
import kotlin.test.Test
import kotlin.test.assertEquals

@RunWith(AndroidJUnit4::class)
class SkillPickerTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun aPickedSkillShowsAsAChipAndGoesFirstInThePrompt() {
        var draft by mutableStateOf(PromptDraft(text = "看看这次改动"))
        var loads = 0
        val sent = mutableListOf<String>()
        val catalog = SkillCatalog(listOf(RemoteSkillOption("code-review", "代码评审", "Review a diff", RemoteSkillOption.Kind.Skill, "builtin")))
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                Composer(
                    draft,
                    { draft = it },
                    placeholder = "",
                    onSend = { sent += it.promptText },
                    skills = ComposerSkills(catalog, { loads += 1 }, { "代码评审" }),
                )
            }
        }
        composeRule.onNodeWithTag("composer.attach").performClick()
        composeRule.onNodeWithTag("attach.skills").performClick()
        composeRule.waitForIdle()
        assertEquals(1, loads, "the list refreshes when the picker opens")
        composeRule.onNodeWithTag("skills.option.skill:code-review").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("代码评审").assertExists()
        composeRule.onNodeWithTag("composer.send").performClick()
        assertEquals(listOf("@skill:code-review 看看这次改动"), sent)
    }
}
