package org.vetta.android.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.vetta.android.ui.design.springClickable
import org.vetta.android.ui.theme.vettaExtra
import org.vetta.android.ui.work.workColors

/** A group of rows on one rounded card, like an iOS inset list section. */
@Composable
internal fun Section(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surface)) { content() }
}

/** A section with a small title above and a footnote below. */
@Composable
internal fun Titled(title: String?, footer: String? = null, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (title != null) {
            Text(title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp))
        }
        content()
        if (footer != null) {
            Text(footer, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp))
        }
    }
}

@Composable
internal fun Divider() {
    HorizontalDivider(Modifier.padding(start = 16.dp), color = MaterialTheme.vettaExtra.border)
}

@Composable
internal fun Value(label: String, value: String, tag: String? = null, onClick: (() -> Unit)? = null) {
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.springClickable(pressedScale = 0.98f, highlight = RectangleShape, onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 14.dp)
            .then(if (tag != null) Modifier.testTag(tag) else Modifier),
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
internal fun Action(label: String, tag: String, icon: Boolean = false, destructive: Boolean = false, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .springClickable(pressedScale = 0.98f, highlight = RectangleShape, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp)
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = if (destructive) Arrangement.Center else Arrangement.spacedBy(10.dp),
    ) {
        if (icon) Icon(Icons.Filled.QrCodeScanner, contentDescription = null, modifier = Modifier.size(20.dp))
        Text(label, style = MaterialTheme.typography.bodyLarge, color = if (destructive) MaterialTheme.workColors.red else MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
internal fun Toggle(label: String, on: Boolean, tag: String, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().springClickable(pressedScale = 1f, role = Role.Switch) { onChange(!on) }.padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Switch(
            checked = on,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(checkedTrackColor = MaterialTheme.workColors.pill, checkedThumbColor = MaterialTheme.workColors.pillInk),
            modifier = Modifier.testTag(tag),
        )
    }
}

/** One option of a single choice, ticked while chosen. */
@Composable
internal fun Choice(label: String, chosen: Boolean, tag: String, onChoose: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .springClickable(pressedScale = 0.98f, highlight = RectangleShape, role = Role.RadioButton, onClick = onChoose)
            .semantics {
                role = Role.RadioButton
                selected = chosen
            }.padding(horizontal = 16.dp, vertical = 14.dp)
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        if (chosen) Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(20.dp))
    }
}
