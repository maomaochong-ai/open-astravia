package org.vetta.android.domain.work

import org.vetta.android.domain.remote.RemoteSkillOption

/**
 * A skill or scene the prompt refers to (port of the iPhone's `SkillReference`,
 * ADR-0137). On the wire it is a token at the start of the text, `@skill:name` or
 * `@scene:name`, the same form the desktop composer writes; the desktop turns a scene
 * into its prompt resource.
 */
data class SkillReference(val kind: RemoteSkillOption.Kind, val name: String) {
    val id: String
        get() = "${kind.wire}:$name"

    /** Names without whitespace or quotes go bare; anything else is quoted, quotes dropped. */
    val token: String
        get() {
            val bare = name.isNotEmpty() && name.none { it.isWhitespace() || it == '"' }
            return "@${kind.wire}:" + if (bare) name else "\"${name.replace("\"", "")}\""
        }
}

object SkillTokens {
    /** The prompt the desktop receives: the references first, then what the user typed. */
    fun prompt(skills: List<SkillReference>, text: String): String = (skills.map { it.token } + listOfNotNull(text.ifEmpty { null })).joinToString(" ")

    /**
     * The references a message starts with, and the text after them. Tokens later in the
     * text are left as they are: pulling them out mid-sentence would leave a hole.
     */
    fun split(text: String): Pair<List<SkillReference>, String> {
        var rest = text
        val skills = mutableListOf<SkillReference>()
        while (true) {
            val (skill, after) = leadingToken(rest.trimStart()) ?: break
            if (skill !in skills) skills += skill
            rest = after
        }
        if (skills.isEmpty()) return emptyList<SkillReference>() to text
        return skills to rest.trimStart()
    }

    /** Characters that end a bare name, as the desktop's parser has them. */
    private val BARE_STOP = setOf('"', '。', '，', '、', '；', '：', '！', '？', '（', '）', '【', '】', '「', '」', '『', '』')

    private fun leadingToken(text: String): Pair<SkillReference, String>? {
        if (!text.startsWith("@")) return null
        val afterAt = text.substring(1)
        for (kind in RemoteSkillOption.Kind.entries) {
            val prefix = "${kind.wire}:"
            if (!afterAt.startsWith(prefix)) continue
            val value = afterAt.substring(prefix.length)
            val name: String
            val after: String
            if (value.startsWith("\"")) {
                val close = value.indexOf('"', 1)
                if (close < 0) return null
                name = value.substring(1, close)
                after = value.substring(close + 1)
            } else {
                val end = value.indexOfFirst { it.isWhitespace() || it in BARE_STOP }.let { if (it < 0) value.length else it }
                name = value.substring(0, end)
                after = value.substring(end)
            }
            if (name.isEmpty()) return null
            return SkillReference(kind, name) to after
        }
        return null
    }
}

/** One project's skill list as the picker shows it. */
data class SkillCatalog(
    /** Null until the first list arrives. */
    val options: List<RemoteSkillOption>? = null,
    val loading: Boolean = false,
    /** The last fetch failed; [options] still holds the list before it, if any. */
    val failed: Boolean = false,
)

/** The picker's search: name, display name or description, ignoring case; the desktop's order is kept. */
fun List<RemoteSkillOption>.matching(query: String): List<RemoteSkillOption> {
    val needle = query.trim()
    if (needle.isEmpty()) return this
    return filter { option -> listOf(option.name, option.alias.orEmpty(), option.description).any { it.contains(needle, ignoreCase = true) } }
}
