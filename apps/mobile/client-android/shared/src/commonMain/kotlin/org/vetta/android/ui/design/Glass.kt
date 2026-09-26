package org.vetta.android.ui.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.vetta.android.ui.work.workColors

/**
 * A floating control's surface, in the spirit of iOS's Liquid Glass: a translucent fill
 * over the page, a bright hairline along the top edge where light would catch it, and a
 * soft shadow that lifts it off the content. `tint` fills it with a colour instead,
 * for a prominent control.
 */
@Composable
fun GlassSurface(
    modifier: Modifier = Modifier,
    shape: Shape = CircleShape,
    tint: Color? = null,
    content: @Composable BoxScope.() -> Unit,
) {
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val fill = tint ?: if (dark) MaterialTheme.workColors.card2.copy(alpha = 0.82f) else Color.White.copy(alpha = 0.86f)
    val edge =
        Brush.verticalGradient(
            if (dark) {
                listOf(Color.White.copy(alpha = 0.16f), Color.White.copy(alpha = 0.04f))
            } else {
                listOf(Color.White, Color.Black.copy(alpha = 0.06f))
            },
        )
    Box(
        modifier
            .shadow(if (dark) 0.dp else 10.dp, shape, ambientColor = Color.Black.copy(alpha = 0.06f), spotColor = Color.Black.copy(alpha = 0.14f))
            .clip(shape)
            .background(fill)
            .border(0.75.dp, edge, shape),
        contentAlignment = Alignment.Center,
        content = content,
    )
}

/** A round glass button holding one icon, as Home's Close, Search and Settings. */
@Composable
fun GlassCircleButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 48.dp,
    enabled: Boolean = true,
    tag: String? = null,
) {
    GlassSurface(
        modifier
            .size(size)
            .alpha(if (enabled) 1f else 0.4f)
            .springClickable(enabled = enabled, highlight = CircleShape, onClick = onClick)
            .semantics { this.contentDescription = contentDescription }
            .then(if (tag != null) Modifier.testTag(tag) else Modifier),
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurface, modifier = Modifier.size(size * 0.42f))
    }
}

/**
 * A capsule glass button with an icon and a label. `prominent` fills it with the ink
 * colour for the one action a page wants taken, like iOS's prominent glass.
 */
@Composable
fun GlassCapsuleButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    prominent: Boolean = false,
    enabled: Boolean = true,
    height: Dp = 52.dp,
    tag: String? = null,
) {
    val colors = MaterialTheme.workColors
    val ink = if (prominent) colors.pillInk else MaterialTheme.colorScheme.onSurface
    val shape = CircleShape
    GlassSurface(
        modifier
            .height(height)
            .alpha(if (enabled) 1f else 0.4f)
            .springClickable(enabled = enabled, highlight = shape, onClick = onClick)
            .then(if (tag != null) Modifier.testTag(tag) else Modifier),
        shape = shape,
        tint = if (prominent) colors.pill else null,
    ) {
        CompositionLocalProvider(LocalContentColor provides ink) {
            Row(
                Modifier.padding(horizontal = 24.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (icon != null) Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp))
                Text(text, style = MaterialTheme.typography.titleSmall, color = ink, maxLines = 1)
            }
        }
    }
}
