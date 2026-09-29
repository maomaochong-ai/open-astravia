package org.vetta.android.domain.work

import kotlinx.serialization.json.Json
import org.vetta.android.domain.remote.RemoteApi
import org.vetta.android.domain.remote.RemoteSkillOption
import org.vetta.android.domain.remote.RemoteSkillOption.Kind
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SkillReferenceTest {
    private val review = SkillReference(Kind.Skill, "code-review")
    private val weekly = SkillReference(Kind.Scene, "周报 模板")

    @Test
    fun skillsGoFirstAsTokensTheDesktopReads() {
        assertEquals("@skill:code-review @scene:\"周报 模板\" 看看这次改动", SkillTokens.prompt(listOf(review, weekly), "看看这次改动"))
        assertEquals("@skill:code-review", SkillTokens.prompt(listOf(review), ""))
        assertEquals("@skill:\"say hi\"", SkillReference(Kind.Skill, "say \"hi\"").token, "quotes inside a name are dropped")
    }

    @Test
    fun aMessageIsSplitIntoItsLeadingSkillsAndTheRest() {
        assertEquals(listOf(review, weekly) to "看看这次改动", SkillTokens.split("@skill:code-review @scene:\"周报 模板\" 看看这次改动"))
        assertEquals(listOf(review) to "", SkillTokens.split("@skill:code-review"))
        assertEquals(listOf(SkillReference(Kind.Skill, "翻译")) to "，谢谢", SkillTokens.split("@skill:翻译，谢谢"))
        assertEquals(emptyList<SkillReference>() to "请用 @skill:code-review 看看", SkillTokens.split("请用 @skill:code-review 看看"), "only leading tokens count")
        assertEquals(emptyList<SkillReference>() to "@skill:\"未闭合", SkillTokens.split("@skill:\"未闭合"))
    }

    @Test
    fun aDraftTakesOneSceneAndCanBeSentWithOnlyASkill() {
        var draft = PromptDraft().addingSkill(review).addingSkill(review)
        assertEquals(listOf(review), draft.skills)
        assertTrue(draft.canSend, "a skill is often a whole instruction")
        draft = draft.addingSkill(weekly).addingSkill(SkillReference(Kind.Scene, "日报"))
        assertEquals(listOf(review, SkillReference(Kind.Scene, "日报")), draft.skills, "a new scene replaces the old one")
        draft = draft.removingSkill(review.id).removingSkill("scene:日报")
        assertFalse(draft.canSend)
        assertTrue(draft.isEmpty)
    }

    @Test
    fun readsTheDesktopsSkillListAndSearchesIt() {
        val options =
            RemoteApi.readSkillOptions(
                Json.parseToJsonElement(
                    """{"skills":[{"name":"code-review","alias":"代码评审","description":"Review a diff","type":"skill","source":"builtin"},
                    {"name":"weekly","alias":"weekly","description":"写周报","type":"scene","source":"user"},
                    {"name":"broken","type":"tool"},{"type":"skill"}]}""",
                ),
            )
        assertEquals(
            listOf(
                RemoteSkillOption("code-review", "代码评审", "Review a diff", Kind.Skill, "builtin"),
                RemoteSkillOption("weekly", null, "写周报", Kind.Scene, "user"),
            ),
            options,
        )
        assertEquals(listOf("weekly"), options.matching("周报").map { it.name })
        assertEquals(listOf("code-review"), options.matching("REVIEW").map { it.name })
        assertEquals(options, options.matching("  "))
    }
}
