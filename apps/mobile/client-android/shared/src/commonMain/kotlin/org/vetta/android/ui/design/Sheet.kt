package org.vetta.android.ui.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.resources.Res
import org.vetta.android.resources.close
import org.vetta.android.ui.theme.vettaExtra
import org.vetta.android.ui.work.workColors

/**
 * A sheet that rises from the bottom, as iOS presents one: the page colour, large
 * rounded corners, a grabber, and a title with a round close button. `expanded` opens
 * it at full height; otherwise it stops halfway first and can be pulled up.
 * Closing animates the sheet down before [onDismiss] runs.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VettaSheet(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    expanded: Boolean = false,
    content: @Composable ColumnScope.(close: () -> Unit) -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = expanded)
    val scope = rememberCoroutineScope()
    val close: () -> Unit = {
        scope.launch { state.hide() }.invokeOnCompletion { if (!state.isVisible) onDismiss() }
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = state,
        modifier = modifier,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        dragHandle = {
            Box(
                Modifier
                    .padding(top = 8.dp, bottom = 4.dp)
                    .size(width = 36.dp, height = 5.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.workColors.faint.copy(alpha = 0.5f)),
            )
        },
    ) {
        Column(Modifier.fillMaxWidth()) {
            if (title != null) {
                Row(
                    Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 4.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        title,
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f).semantics { heading() },
                    )
                    GlassCircleButton(Icons.Filled.Close, stringResource(Res.string.close), onClick = close, size = 36.dp, tag = "sheet.close")
                }
            }
            content(close)
        }
    }
}
