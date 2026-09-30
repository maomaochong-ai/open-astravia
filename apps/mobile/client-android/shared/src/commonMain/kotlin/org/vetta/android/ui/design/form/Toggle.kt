package org.vetta.android.ui.design.form

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import org.vetta.android.ui.design.springClickable
import org.vetta.android.ui.work.workColors

/**
 * A switch row, SwiftUI's `Toggle`. The whole row toggles. The off state is a filled
 * light track and a light knob, and the control is drawn smaller than Material's switch.
 * Inside a [Section], prefer [SectionScope.toggle].
 */
@Composable
fun Toggle(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    supporting: String? = null,
    tag: String? = null,
) {
    val colors = MaterialTheme.workColors
    val dark = formDark()
    val offTrack = if (dark) Color(0xFF3A3F46) else Color(0xFFE4E6EA)
    val offThumb = if (dark) colors.pill else Color.White
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = FormMetrics.MinRowHeight)
            .springClickable(pressedScale = 1f, role = Role.Switch) { onCheckedChange(!checked) }
            .padding(horizontal = FormMetrics.RowPadding, vertical = if (supporting != null) 10.dp else 0.dp),
        // A caption makes the row tall. The switch stays on the title, not the middle of the paragraph.
        verticalAlignment = if (supporting != null) Alignment.Top else Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(FormMetrics.IconGap),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, style = formLabelStyle())
            if (supporting != null) {
                Text(supporting, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        // The row is already a 44dp target. The switch's own 48dp minimum would make this row taller than a button.
        CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides 0.dp) {
            Switch(
                checked = checked,
                onCheckedChange = onCheckedChange,
                colors =
                    SwitchDefaults.colors(
                        checkedThumbColor = colors.pillInk,
                        checkedTrackColor = colors.pill,
                        checkedBorderColor = Color.Transparent,
                        uncheckedThumbColor = offThumb,
                        uncheckedTrackColor = offTrack,
                        uncheckedBorderColor = Color.Transparent,
                    ),
                modifier = Modifier.scaleLayout(FormMetrics.SwitchScale).optionalTag(tag),
            )
        }
    }
}

@Composable
fun SectionScope.toggle(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    supporting: String? = null,
    tag: String? = null,
) {
    Toggle(label, checked, onCheckedChange, modifier.layoutId(FormMetrics.RowPadding), supporting, tag)
}

/** Scales a control and reports the scaled size, so the switch sits in a 44dp row. */
private fun Modifier.scaleLayout(scale: Float): Modifier =
    layout { measurable, constraints ->
        val placeable = measurable.measure(constraints)
        val width = (placeable.width * scale).roundToInt().coerceAtLeast(1)
        val height = (placeable.height * scale).roundToInt().coerceAtLeast(1)
        layout(width, height) {
            placeable.placeRelativeWithLayer(
                ((width - placeable.width) / 2f).roundToInt(),
                ((height - placeable.height) / 2f).roundToInt(),
            ) {
                scaleX = scale
                scaleY = scale
            }
        }
    }
