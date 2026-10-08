package org.vetta.android.ui.design.form

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.unit.dp
import org.vetta.android.ui.design.springClickable
import org.vetta.android.ui.theme.vettaExtra
import org.vetta.android.ui.work.workColors

/**
 * A stepped value, SwiftUI's `Stepper`: the label and the number on the leading side,
 * minus and plus sharing one recessed capsule on the trailing side.
 */
@Composable
fun Stepper(
    label: String,
    value: Int,
    onValueChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
    range: IntRange = 0..100,
) {
    Row(
        modifier.fillMaxWidth().heightIn(min = FormMetrics.MinRowHeight).padding(horizontal = FormMetrics.RowPadding),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(FormMetrics.IconGap),
    ) {
        Text(label, style = formLabelStyle(), modifier = Modifier.weight(1f))
        Text(value.toString(), style = formLabelStyle(), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(
            Modifier.height(32.dp).clip(RoundedCornerShape(8.dp)).background(grooveColor()),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            StepperHalf(Icons.Filled.Remove, enabled = value > range.first) { onValueChange(value - 1) }
            Box(Modifier.width(0.5.dp).fillMaxHeight().padding(vertical = 6.dp).background(MaterialTheme.vettaExtra.border))
            StepperHalf(Icons.Filled.Add, enabled = value < range.last) { onValueChange(value + 1) }
        }
    }
}

@Composable
private fun StepperHalf(icon: ImageVector, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .width(44.dp)
            .fillMaxHeight()
            .alpha(if (enabled) 1f else 0.35f)
            .springClickable(enabled = enabled, pressedScale = 0.96f, highlight = RectangleShape, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.workColors.ink2, modifier = Modifier.size(16.dp))
    }
}

@Composable
fun SectionScope.stepper(
    label: String,
    value: Int,
    onValueChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
    range: IntRange = 0..100,
) {
    Stepper(label, value, onValueChange, modifier.layoutId(FormMetrics.RowPadding), range)
}
