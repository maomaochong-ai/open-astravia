package org.vetta.android.domain.work

import kotlinx.serialization.json.jsonPrimitive
import org.vetta.android.domain.remote.AttachmentKind
import org.vetta.android.domain.remote.RemoteApi
import org.vetta.android.domain.remote.RemoteModelOption
import org.vetta.android.domain.remote.RemoteQuestionAnswer
import org.vetta.android.domain.remote.RemoteQuestionItem
import org.vetta.android.domain.remote.RemoteQuestionOption
import org.vetta.android.domain.remote.RemoteQuestionRequest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PromptDraftTest {
    private fun file(name: String, bytes: Int) = PromptAttachment(AttachmentKind.File, name, "application/octet-stream", ByteArray(bytes))

    @Test
    fun needsWordsToSendAndClearsAfterwards() {
        var draft = PromptDraft(text = "  \n ")
        assertFalse(draft.canSend)
        draft = draft.adding(file("a.txt", 10))
        assertFalse(draft.canSend, "an attachment alone is not a prompt")
        draft = draft.copy(text = "看看这个\n第二行")
        assertTrue(draft.canSend)
        assertEquals("看看这个\n第二行", draft.trimmedText, "newlines inside the prompt are kept")
        assertTrue(PromptDraft().isEmpty)
    }

    @Test
    fun refusesFilesAFrameCannotCarryAndTooManyAttachments() {
        var draft = PromptDraft()
        assertEquals(
            PromptAttachmentError.TooLarge("big.zip"),
            assertFailsWith<PromptAttachmentError> { draft.adding(file("big.zip", RemoteApi.MAX_UPLOAD_BYTES + 1)) },
        )
        assertEquals(PromptAttachmentError.TooLarge("empty"), assertFailsWith<PromptAttachmentError> { draft.adding(file("empty", 0)) })
        repeat(PromptDraft.MAX_ATTACHMENTS) { draft = draft.adding(file("f$it", RemoteApi.MAX_UPLOAD_BYTES)) }
        assertEquals(PromptAttachmentError.TooMany, assertFailsWith<PromptAttachmentError> { draft.adding(file("one more", 1)) })
        draft = draft.removing(draft.attachments.first().id)
        assertEquals(PromptDraft.MAX_ATTACHMENTS - 1, draft.attachments.size)
    }

    @Test
    fun uploadPayloadCarriesTheBytesAsBase64() {
        val payload = PromptAttachment(AttachmentKind.Image, "p.png", "image/png", byteArrayOf(1, 2, 3)).toJson()
        assertEquals("image", payload["kind"]?.jsonPrimitive?.content)
        assertEquals("AQID", payload["data"]?.jsonPrimitive?.content)
    }

    @Test
    fun dictationJoinsWhatIsTyped() {
        var draft = PromptDraft().insertingDictation("  帮我看看构建 ")
        assertEquals("帮我看看构建", draft.text)
        draft = draft.insertingDictation("顺便跑测试")
        assertEquals("帮我看看构建顺便跑测试", draft.text, "Chinese needs no space")
        draft = draft.copy(text = "Run the build.").insertingDictation("then tests")
        assertEquals("Run the build. then tests", draft.text)
        draft = draft.copy(text = "第一行\n").insertingDictation("second")
        assertEquals("第一行\nsecond", draft.text)
        assertEquals("第一行\nsecond", draft.insertingDictation("   ").text)
    }
}

class QuestionDraftTest {
    private val request =
        RemoteQuestionRequest(
            "q1",
            listOf(
                RemoteQuestionItem("继续吗？", "确认", listOf(RemoteQuestionOption("继续", ""), RemoteQuestionOption("先停下", "")), false),
                RemoteQuestionItem("通知谁？", "通知", listOf(RemoteQuestionOption("产品", ""), RemoteQuestionOption("测试", "")), true),
            ),
        )

    @Test
    fun singleChoiceKeepsOneAnswerAndOtherReplacesIt() {
        var draft = QuestionDraft(request).toggle("继续", 0).toggle("先停下", 0)
        assertEquals(listOf("先停下"), draft.answers(0))
        draft = draft.settingOtherText("明天再说", 0)
        assertTrue(draft.isOtherActive(0))
        assertEquals(listOf("明天再说"), draft.answers(0), "typing an answer replaces the picked option")
        draft = draft.toggle("继续", 0)
        assertFalse(draft.isOtherActive(0))
        assertEquals(listOf("继续"), draft.answers(0), "picking an option turns Other off but keeps its text")
        assertEquals("明天再说", draft.otherText(0))
    }

    @Test
    fun multipleChoiceCombinesOptionsAndOther() {
        var draft = QuestionDraft(request).toggle("产品", 1).toggle("测试", 1).toggle("产品", 1).toggleOther(1)
        assertEquals(listOf("测试"), draft.answers(1), "Other counts only once it has text")
        draft = draft.settingOtherText("  设计 ", 1)
        assertEquals(listOf("测试", "设计"), draft.answers(1))
    }

    @Test
    fun stepsThroughQuestionsAndSubmitsOneEntryEach() {
        var draft = QuestionDraft(request)
        assertTrue(!draft.isLast && draft.answeredCount == 0)
        draft = draft.toggle("继续", 0).next()
        assertTrue(draft.current == 1 && draft.isLast)
        assertFalse(draft.allAnswered)
        draft = draft.toggle("测试", 1).next()
        assertEquals(1, draft.current, "there is nothing after the last question")
        assertTrue(draft.allAnswered)
        assertEquals(
            listOf(RemoteQuestionAnswer("继续吗？", listOf("继续")), RemoteQuestionAnswer("通知谁？", listOf("测试"))),
            draft.result,
        )
    }
}

class ModelChoiceTest {
    private val options =
        listOf(
            RemoteModelOption("anthropic/fable", "Fable", "anthropic", listOf("off", "low", "high"), supportsImage = true),
            RemoteModelOption("zai/glm", "GLM", "zai", listOf("none", "high", "max"), supportsImage = false),
            RemoteModelOption("anthropic/haiku", "Haiku", "anthropic", emptyList(), supportsImage = true),
        )

    @Test
    fun offersTheChosenModelsLevelsAndNoneForTheDefault() {
        assertTrue(ModelChoice().levels(options).isEmpty())
        assertEquals(listOf("none", "high", "max"), ModelChoice("zai/glm").levels(options))
        assertTrue(ModelChoice("gone/model").levels(options).isEmpty())
    }

    @Test
    fun keepsTheLevelOnlyWhereTheNewModelOffersIt() {
        var choice = ModelChoice("anthropic/fable", "high").picking("zai/glm", options)
        assertEquals(ModelChoice("zai/glm", "high"), choice)
        choice = choice.picking("anthropic/haiku", options)
        assertEquals(ModelChoice("anthropic/haiku", null), choice)
        assertEquals(ModelChoice(), ModelChoice("zai/glm", "max").picking(null, options), "the default model's levels are unknown")
    }

    @Test
    fun groupsByProviderInTheDesktopsOrder() {
        val groups = ModelChoice.groups(options)
        assertEquals(listOf("anthropic", "zai"), groups.map { it.provider })
        assertEquals(listOf("anthropic/fable", "anthropic/haiku"), groups[0].models.map { it.key })
    }
}
