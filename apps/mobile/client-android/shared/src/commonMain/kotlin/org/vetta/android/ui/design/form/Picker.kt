package org.vetta.android.ui.design.form

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import org.vetta.android.ui.design.VettaMotion
import org.vetta.android.ui.design.springClickable
import org.vetta.android.ui.theme.vettaExtra

/** One choice in a segmented [Picker]. `tag` is the test id of that segment. */
data class Segment(
    val label: String,
    val selected: Boolean,
    val tag: String,
    val onSelect: () -> Unit,
)

/**
 * A segmented picker on the same card as the other rows.
 *
 * The card is the background. The chosen segment is a slightly gray button. Changing
 * the choice grows that button, slides it to the tapped segment, then settles it down.
 */
@Composable
fun Picker(options: List<Segment>, modifier: Modifier = Modifier) {
    if (options.isEmpty()) return
    val inset = 4.dp
    val thumbShape = RoundedCornerShape(FormMetrics.Corner - inset)
    val selectedIndex = options.indexOfFirst { it.selected }.coerceAtLeast(0)
    val position = remember { Animatable(selectedIndex.toFloat()) }
    val scale = remember { Animatable(1f) }
    var placed by remember { mutableStateOf(false) }
    LaunchedEffect(selectedIndex) {
        if (!placed) {
            position.snapTo(selectedIndex.toFloat())
            placed = true
            return@LaunchedEffect
        }
        // Grow while the slide starts, stay large for the travel, then shrink once it lands.
        coroutineScope {
            launch { scale.animateTo(1.08f, VettaMotion.snappy()) }
            launch { position.animateTo(selectedIndex.toFloat(), VettaMotion.smooth()) }
        }
        scale.animateTo(1f, VettaMotion.snappy())
    }
    BoxWithConstraints(
        modifier
            .fillMaxWidth()
            .height(44.dp)
            .padding(inset),
    ) {
        val segment = maxWidth / options.size
        val grown = scale.value
        Box(
            Modifier
                .offset(x = segment * position.value)
                .width(segment)
                .fillMaxHeight()
                .graphicsLayer {
                    scaleX = grown
                    scaleY = grown
                }
                .clip(thumbShape)
                .background(MaterialTheme.vettaExtra.chipBackground)
                .border(0.75.dp, MaterialTheme.vettaExtra.border, thumbShape),
        )
        Row(Modifier.fillMaxSize()) {
            for (option in options) {
                Box(
                    Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .springClickable(pressedScale = 1f, role = Role.RadioButton, onClick = option.onSelect)
                        .semantics {
                            role = Role.RadioButton
                            selected = option.selected
                        }
                        .optionalTag(option.tag),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        option.label,
                        style = formLabelStyle(),
                        fontWeight = if (option.selected) FontWeight.Medium else FontWeight.Normal,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        softWrap = false,
                    )
                }
            }
        }
    }
}

@Composable
fun SectionScope.picker(options: List<Segment>, modifier: Modifier = Modifier) {
    Picker(options, modifier.layoutId(FormMetrics.RowPadding))
}
