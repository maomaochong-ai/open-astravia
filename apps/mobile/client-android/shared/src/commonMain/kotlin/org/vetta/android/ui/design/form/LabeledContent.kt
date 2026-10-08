package org.vetta.android.ui.design.form

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.vetta.android.ui.design.springClickable
import org.vetta.android.ui.work.workColors

/**
 * A label with a secondary value, SwiftUI's `LabeledContent`.
 * [onClick] adds a chevron and makes the row open something, as an iOS detail row does.
 */
@Composable
fun LabeledContent(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    tag: String? = null,
) {
    val labelStyle = formLabelStyle()
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = FormMetrics.MinRowHeight)
            .then(
                if (onClick != null) {
                    Modifier.springClickable(pressedScale = 0.98f, highlight = RectangleShape, onClick = onClick)
                } else {
                    Modifier
                },
            )
            .padding(horizontal = FormMetrics.RowPadding)
            .optionalTag(tag),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(label, style = labelStyle, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(value, style = labelStyle, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        if (onClick != null) {
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.workColors.ink2,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

@Composable
fun SectionScope.labeledContent(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    tag: String? = null,
) {
    LabeledContent(label, value, modifier.layoutId(FormMetrics.RowPadding), onClick, tag)
}
