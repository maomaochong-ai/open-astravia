package org.vetta.android.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.vetta.android.domain.markdown.MdBlock
import org.vetta.android.domain.markdown.MdInline
import org.vetta.android.domain.markdown.MarkdownParser
import org.vetta.android.ui.i18n.Str

@Composable
fun MarkdownContent(
    source: String,
    modifier: Modifier = Modifier,
    onSurface: Boolean = false,
) {
    val blocks = remember(source) { MarkdownParser.parse(source) }
    Column(modifier = modifier) {
        blocks.forEachIndexed { index, block ->
            if (index > 0) Spacer(Modifier.height(8.dp))
            when (block) {
                is MdBlock.Heading -> {
                    val style =
                        when (block.level) {
                            1 -> MaterialTheme.typography.headlineSmall
                            2 -> MaterialTheme.typography.titleLarge
                            3 -> MaterialTheme.typography.titleMedium
                            else -> MaterialTheme.typography.titleSmall
                        }
                    Text(
                        text = inlinesToAnnotated(block.inlines),
                        style = style,
                        color =
                            if (onSurface) {
                                MaterialTheme.colorScheme.onPrimary
                            } else {
                                MaterialTheme.colorScheme.onSurface
                            },
                    )
                }
                is MdBlock.Paragraph -> {
                    Text(
                        text = inlinesToAnnotated(block.inlines),
                        style = MaterialTheme.typography.bodyLarge,
                        color =
                            if (onSurface) {
                                MaterialTheme.colorScheme.onPrimary
                            } else {
                                MaterialTheme.colorScheme.onSurface
                            },
                    )
                }
                is MdBlock.BulletList -> {
                    block.items.forEach { item ->
                        Row(Modifier.padding(vertical = 2.dp)) {
                            Text("•  ", style = MaterialTheme.typography.bodyLarge)
                            Text(
                                text = inlinesToAnnotated(item),
                                style = MaterialTheme.typography.bodyLarge,
                            )
                        }
                    }
                }
                is MdBlock.OrderedList -> {
                    block.items.forEachIndexed { i, item ->
                        Row(Modifier.padding(vertical = 2.dp)) {
                            Text("${i + 1}. ", style = MaterialTheme.typography.bodyLarge)
                            Text(
                                text = inlinesToAnnotated(item),
                                style = MaterialTheme.typography.bodyLarge,
                            )
                        }
                    }
                }
                is MdBlock.CodeBlock -> {
                    CodeBlockChrome(language = block.language, code = block.code)
                }
            }
        }
    }
}

@Composable
fun CodeBlockChrome(
    language: String?,
    code: String,
    modifier: Modifier = Modifier,
) {
    val clipboard = LocalClipboardManager.current
    var copied by remember(code) { mutableStateOf(false) }
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
        tonalElevation = 1.dp,
    ) {
        Column {
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f))
                        .padding(horizontal = 10.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = language?.ifBlank { "code" } ?: "code",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                TextButton(
                    onClick = {
                        clipboard.setText(AnnotatedString(code))
                        copied = true
                    },
                ) {
                    Text(if (copied) Str.copied else Str.copy)
                }
            }
            SelectionContainer {
                Text(
                    text = code,
                    style =
                        MaterialTheme.typography.bodyMedium.copy(
                            fontFamily = FontFamily.Monospace,
                            fontSize = 13.sp,
                            lineHeight = 18.sp,
                        ),
                    modifier =
                        Modifier
                            .horizontalScroll(rememberScrollState())
                            .padding(12.dp),
                )
            }
        }
    }
}

@Composable
private fun inlinesToAnnotated(inlines: List<MdInline>): AnnotatedString =
    buildAnnotatedString {
        inlines.forEach { inline ->
            when (inline) {
                is MdInline.Text -> append(inline.text)
                is MdInline.Bold -> {
                    val start = length
                    append(inline.text)
                    addStyle(SpanStyle(fontWeight = FontWeight.Bold), start, length)
                }
                is MdInline.Italic -> {
                    val start = length
                    append(inline.text)
                    addStyle(SpanStyle(fontStyle = FontStyle.Italic), start, length)
                }
                is MdInline.Code -> {
                    val start = length
                    append(inline.text)
                    addStyle(
                        SpanStyle(
                            fontFamily = FontFamily.Monospace,
                            background = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
                        ),
                        start,
                        length,
                    )
                }
                is MdInline.Link -> {
                    val start = length
                    append(inline.text.ifBlank { inline.url })
                    addStyle(
                        SpanStyle(
                            color = MaterialTheme.colorScheme.primary,
                            textDecoration = TextDecoration.Underline,
                        ),
                        start,
                        length,
                    )
                }
            }
        }
    }
