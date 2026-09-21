package org.vetta.android.ui.chat

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.vetta.android.ui.i18n.Str

/** The small, user-facing projection shown in a tool trace header. */
data class ToolPresentation(
    val label: String,
    val summary: String? = null,
)

data class ToolQuestionResolution(
    val cancelled: Boolean,
    val answers: List<Pair<String, List<String>>>,
)

private val toolArgumentsJson = Json { ignoreUnknownKeys = true }

fun presentTool(toolName: String, arguments: String?): ToolPresentation {
    val args = arguments?.let(::parseArguments)
    val label =
        when {
            toolName.startsWith("mcp_") -> Str.toolIntegration
            toolName == "read" || toolName == "read_file" -> Str.toolReadFile
            toolName == "write" || toolName == "write_file" -> Str.toolWriteFile
            toolName == "edit" || toolName == "edit_file" -> Str.toolEditFile
            toolName == "bash" || toolName == "shell" -> Str.toolRunCommand
            toolName == "ask_user_question" -> Str.toolAskQuestion
            toolName == "grep" || toolName == "find" || toolName == "ls" || toolName == "dir_tree" || toolName == "tree" ->
                Str.toolSearchFiles
            else -> Str.toolAction
        }
    val summary =
        when {
            toolName == "read" || toolName == "read_file" ||
                toolName == "write" || toolName == "write_file" ||
                toolName == "edit" || toolName == "edit_file" ->
                args.firstString("file_path", "path", "uri")
            toolName == "bash" || toolName == "shell" -> args.string("command")?.let(::firstLine)
            toolName == "grep" -> args.string("pattern")?.let { "/${shorten(it, 56)}/" }
            toolName == "find" || toolName == "ls" || toolName == "dir_tree" || toolName == "tree" ->
                args.firstString("path", "pattern")
            toolName == "ask_user_question" -> args.firstQuestion()
            toolName.startsWith("mcp_") -> args.firstString("path", "uri", "url", "file_path")
            else -> args.firstString("path", "file_path", "command")
        }
    return ToolPresentation(label = label, summary = summary?.let { shorten(it, 72) })
}

fun parseToolQuestionResolution(toolName: String, result: String?): ToolQuestionResolution? {
    if (toolName != "ask_user_question" || result.isNullOrBlank()) return null
    val value = runCatching { toolArgumentsJson.parseToJsonElement(result).jsonObject }.getOrNull() ?: return null
    val cancelled = value["cancelled"]?.jsonPrimitive?.contentOrNull?.toBooleanStrictOrNull() ?: return null
    val answers =
        (value["answers"] as? JsonArray).orEmpty().mapNotNull { item ->
            val answer = item as? JsonObject ?: return@mapNotNull null
            val question = answer.string("question") ?: return@mapNotNull null
            val selected =
                (answer["answers"] as? JsonArray).orEmpty().mapNotNull { selected ->
                    selected.jsonPrimitive.contentOrNull?.takeIf { it.isNotBlank() }
                }
            question to selected
        }
    return ToolQuestionResolution(cancelled = cancelled, answers = answers)
}

private fun parseArguments(value: String): JsonObject? =
    runCatching { toolArgumentsJson.parseToJsonElement(value).jsonObject }.getOrNull()

private fun JsonObject?.string(key: String): String? = this?.get(key)?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }

private fun JsonObject?.firstString(vararg keys: String): String? = keys.firstNotNullOfOrNull { string(it) }

private fun JsonObject?.firstQuestion(): String? {
    val questions = this?.get("questions") as? JsonArray ?: return null
    return questions.firstOrNull()?.let { (it as? JsonObject)?.string("question") }
}

private fun firstLine(value: String): String = value.lineSequence().firstOrNull()?.trim().orEmpty()

private fun shorten(value: String, maxLength: Int): String =
    if (value.length <= maxLength) value else "${value.take((maxLength - 1).coerceAtLeast(1))}…"
