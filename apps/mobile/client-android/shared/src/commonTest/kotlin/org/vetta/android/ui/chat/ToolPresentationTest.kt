package org.vetta.android.ui.chat

import org.vetta.android.resources.Res
import org.vetta.android.resources.tool_action
import org.vetta.android.resources.tool_read_file
import org.vetta.android.resources.tool_run_command
import kotlin.test.Test
import kotlin.test.assertEquals

class ToolPresentationTest {
    @Test
    fun fileToolUsesReadableLabelAndPathSummary() {
        assertEquals(
            ToolPresentation(Res.string.tool_read_file, "README.md"),
            presentTool("read_file", "{\"path\":\"README.md\"}"),
        )
    }

    @Test
    fun shellToolShowsOnlyTheFirstCommandLine() {
        assertEquals(
            ToolPresentation(Res.string.tool_run_command, "git status"),
            presentTool("bash", "{\"command\":\"git status\\nprintf done\"}"),
        )
    }

    @Test
    fun malformedArgumentsDoNotBreakTheTraceHeader() {
        assertEquals(ToolPresentation(Res.string.tool_action), presentTool("unknown_tool", "not-json"))
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
