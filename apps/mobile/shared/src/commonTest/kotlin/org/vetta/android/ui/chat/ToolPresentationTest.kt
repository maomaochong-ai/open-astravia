package org.vetta.android.ui.chat

import kotlin.test.Test
import kotlin.test.assertEquals

class ToolPresentationTest {
    @Test
    fun fileToolUsesReadableLabelAndPathSummary() {
        assertEquals(
            ToolPresentation("读取文件", "README.md"),
            presentTool("read_file", "{\"path\":\"README.md\"}"),
        )
    }

    @Test
    fun shellToolShowsOnlyTheFirstCommandLine() {
        assertEquals(
            ToolPresentation("执行命令", "git status"),
            presentTool("bash", "{\"command\":\"git status\\nprintf done\"}"),
        )
    }

    @Test
    fun malformedArgumentsDoNotBreakTheTraceHeader() {
        assertEquals(ToolPresentation("执行操作"), presentTool("unknown_tool", "not-json"))
    }

    @Test
    fun questionResolutionProjectsSelectedLabelsWithoutExposingTheWholePayload() {
        assertEquals(
            ToolQuestionResolution(false, listOf("继续吗？" to listOf("继续"))),
            parseToolQuestionResolution(
                "ask_user_question",
                "{\"cancelled\":false,\"answers\":[{\"question\":\"继续吗？\",\"answers\":[\"继续\"]}]}",
            ),
        )
    }
}
