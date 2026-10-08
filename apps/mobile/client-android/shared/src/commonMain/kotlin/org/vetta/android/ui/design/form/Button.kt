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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.unit.dp
import org.vetta.android.ui.design.springClickable
import org.vetta.android.ui.work.workColors

/** How a [Button] row presents its action. Same roles SwiftUI gives a settings button. */
enum class ButtonRole {
    /** Label on the leading edge. An icon, when present, sits in front of it. */
    Default,

    /** [Default], plus a trailing chevron. SwiftUI's `NavigationLink`. */
    Disclosure,

    /** Centered red label, the whole row being the action, as in iOS Settings' Sign Out. */
    Destructive,
}

/** A settings button. Inside a [Section], prefer [SectionScope.button], which also inserts the separator. */
@Composable
fun Button(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    role: ButtonRole = ButtonRole.Default,
    tag: String? = null,
) {
    val red = MaterialTheme.workColors.red
    val labelStyle = formLabelStyle()
    if (role == ButtonRole.Destructive) {
        Row(
            modifier.rowChrome(onClick).optionalTag(tag),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        ) {
            if (icon != null) {
                Icon(icon, contentDescription = null, tint = red, modifier = Modifier.size(FormMetrics.IconSize))
            }
            Text(label, style = labelStyle, color = red)
        }
    } else {
        Row(
            modifier.rowChrome(onClick).optionalTag(tag),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(FormMetrics.IconGap),
        ) {
            if (icon != null) {
                Icon(icon, contentDescription = null, tint = MaterialTheme.workColors.ink2, modifier = Modifier.size(FormMetrics.IconSize))
            }
            Text(label, style = labelStyle, modifier = Modifier.weight(1f))
            if (role == ButtonRole.Disclosure) {
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = null,
                    tint = MaterialTheme.workColors.ink2,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
    }
}

@Composable
fun SectionScope.button(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    role: ButtonRole = ButtonRole.Default,
    tag: String? = null,
) {
    Button(label, onClick, modifier.layoutId(FormMetrics.RowPadding), icon, role, tag)
}

/** 44dp row whose padding sits inside the touch target. */
@Composable
private fun Modifier.rowChrome(onClick: () -> Unit): Modifier =
    this
        .fillMaxWidth()
        .heightIn(min = FormMetrics.MinRowHeight)
        .springClickable(pressedScale = 0.98f, highlight = RectangleShape, onClick = onClick)
        .padding(horizontal = FormMetrics.RowPadding)
