package org.vetta.android.ui.design.form

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.layoutId

/**
 * A single-line field, SwiftUI's `TextField` inside a form.
 * No outline: the row is the field. [label] sits on the leading edge, like a settings name row.
 */
@Composable
fun TextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    tag: String? = null,
) {
    val style = formLabelStyle().copy(color = MaterialTheme.colorScheme.onSurface)
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        textStyle = style,
        cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
        singleLine = true,
        modifier = modifier.fillMaxWidth().optionalTag(tag),
        decorationBox = { inner ->
            Row(
                Modifier.heightIn(min = FormMetrics.MinRowHeight).padding(horizontal = FormMetrics.RowPadding),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (label != null) {
                    Text(label, style = formLabelStyle(), modifier = Modifier.padding(end = FormMetrics.IconGap))
                }
                Box(Modifier.weight(1f)) {
                    if (value.isEmpty() && placeholder != null) {
                        Text(placeholder, style = formLabelStyle(), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    inner()
                }
            }
        },
    )
}

@Composable
fun SectionScope.textField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    tag: String? = null,
) {
    TextField(value, onValueChange, modifier.layoutId(FormMetrics.RowPadding), label, placeholder, tag)
}
