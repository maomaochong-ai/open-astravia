package org.vetta.android.ui.board

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.RemoteSessionSummary
import org.vetta.android.resources.Res
import org.vetta.android.resources.board_more
import org.vetta.android.resources.board_view_all
import org.vetta.android.resources.home_task_board
import org.vetta.android.ui.design.GlassSurface
import org.vetta.android.ui.design.VettaMotion
import org.vetta.android.ui.design.springClickable
import org.vetta.android.ui.work.BotAvatar
import org.vetta.android.ui.work.workColors

/**
 * The open work under the new-session greeting: the first sessions that are waiting,
 * then any still running, each opening its chat. The footer opens the full board.
 * One glass panel, so the rows are not loose on the welcome wash.
 * Draws nothing while [sessions] is empty. Kept sessions fade before the desktop answers.
 */
@Composable
fun BoardSummary(
    sessions: List<RemoteSessionSummary>,
    hiddenActive: Int,
    online: Boolean,
    avatarAsleep: Boolean,
    conversationCwd: String?,
    onOpenSession: (String) -> Unit,
    onOpenBoard: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (sessions.isEmpty()) return
    val fade by animateFloatAsState(if (online) 1f else 0.6f, VettaMotion.snappy(), label = "summary fade")
    val board = stringResource(Res.string.home_task_board)
    val more = if (hiddenActive > 0) pluralStringResource(Res.plurals.board_more, hiddenActive, hiddenActive) else null
    val viewAll = stringResource(Res.string.board_view_all)
    val ink = MaterialTheme.workColors.ink2
    GlassSurface(
        modifier.fillMaxWidth().graphicsLayer { alpha = fade }.testTag("newSession.overview"),
        shape = RoundedCornerShape(26.dp),
    ) {
        Column(Modifier.fillMaxWidth()) {
            Row(
                Modifier.fillMaxWidth().padding(start = 14.dp, end = 16.dp, top = 14.dp, bottom = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                BotAvatar(size = 24.dp, asleep = avatarAsleep)
                Text(board, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            }
            sessions.forEachIndexed { index, session ->
                if (index > 0) OverviewHairline()
                OverviewRow(session, conversationCwd, onOpen = { onOpenSession(session.id) }, compact = true)
            }
            OverviewHairline(start = 16.dp, end = 16.dp)
            Row(
                Modifier
                    .fillMaxWidth()
                    .springClickable(pressedScale = 0.98f, onClick = onOpenBoard)
                    .semantics { contentDescription = listOfNotNull(board, more, viewAll).joinToString(", ") }
                    .padding(horizontal = 16.dp, vertical = 12.dp)
                    .testTag("newSession.board"),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    listOfNotNull(more, viewAll).joinToString(" · "),
                    style = MaterialTheme.typography.titleSmall,
                    color = ink,
                    modifier = Modifier.weight(1f),
                )
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = ink, modifier = Modifier.size(18.dp))
            }
        }
    }
}
