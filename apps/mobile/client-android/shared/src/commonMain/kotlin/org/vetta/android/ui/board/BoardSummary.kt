package org.vetta.android.ui.board

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.work.TaskBoardCard
import org.vetta.android.resources.Res
import org.vetta.android.resources.board_view_all
import org.vetta.android.resources.home_task_board
import org.vetta.android.resources.work_conversation
import org.vetta.android.resources.work_group_processing
import org.vetta.android.resources.work_group_waiting
import org.vetta.android.ui.design.StatusGlyph
import org.vetta.android.ui.design.VettaMotion
import org.vetta.android.ui.design.springClickable
import org.vetta.android.ui.work.BotAvatar
import org.vetta.android.ui.work.workColors
import org.vetta.android.ui.work.workSessionTitle

/**
 * The task board in brief on New Session (the iPhone's `BoardSummary`), laid out
 * unevenly: the top card tall on the left with its first sessions; on the right the
 * second card over a pill with the totals that opens the board. Each session shown opens
 * its chat. Draws nothing while the board is empty. Kept sessions show, a little faded,
 * before the desktop answers.
 */
@Composable
fun BoardSummary(
    cards: List<TaskBoardCard>,
    waiting: Int,
    running: Int,
    online: Boolean,
    avatarAsleep: Boolean,
    onOpenSession: (String) -> Unit,
    onOpenBoard: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val first = cards.firstOrNull() ?: return
    val fade by animateFloatAsState(if (online) 1f else 0.6f, VettaMotion.snappy(), label = "summary fade")
    Column(modifier.graphicsLayer { alpha = fade }, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            BotAvatar(size = 24.dp, asleep = avatarAsleep)
            Text(stringResource(Res.string.home_task_board), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
        BoxWithConstraints(Modifier.fillMaxWidth().height(196.dp)) {
            val gap = 10.dp
            val side = (maxWidth - gap) * 0.44f
            Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                SummaryCard(first, rows = 3, onOpenSession = onOpenSession, modifier = Modifier.weight(1f).fillMaxHeight())
                Column(Modifier.width(side).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(gap)) {
                    cards.getOrNull(1)?.let { second ->
                        SummaryCard(second, rows = 0, onOpenSession = onOpenSession, modifier = Modifier.fillMaxWidth().weight(1f))
                    }
                    Totals(waiting, running, onOpenBoard, if (cards.size > 1) Modifier.fillMaxWidth().height(52.dp) else Modifier.fillMaxSize())
                }
            }
        }
    }
}

@Composable
private fun Totals(waiting: Int, running: Int, onClick: () -> Unit, modifier: Modifier) {
    val board = stringResource(Res.string.home_task_board)
    val detail =
        listOfNotNull(
            if (waiting > 0) "$waiting ${stringResource(Res.string.work_group_waiting)}" else null,
            if (running > 0) "$running ${stringResource(Res.string.work_group_processing)}" else null,
        ).joinToString(", ")
    Row(
        modifier
            .clip(RoundedCornerShape(26.dp))
            .background(MaterialTheme.workColors.card2)
            .springClickable(highlight = RoundedCornerShape(26.dp), onClick = onClick)
            .semantics { contentDescription = listOf(board, detail).filter(String::isNotEmpty).joinToString(", ") }
            .padding(horizontal = 16.dp)
            .testTag("newSession.board"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (waiting == 0 && running == 0) Text(stringResource(Res.string.board_view_all), style = MaterialTheme.typography.titleSmall)
        if (waiting > 0) CountBadge(RemoteSessionStatus.WaitingInput, waiting)
        if (running > 0) CountBadge(RemoteSessionStatus.Running, running)
        Spacer(Modifier.weight(1f))
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, modifier = Modifier.size(20.dp))
    }
}

/**
 * A board card in brief: where it is, then either its first few sessions, each opening
 * its chat, or, where there is no room for a list, the most pressing one's title with the
 * whole card opening it; a round status badge sits in the corner.
 */
@Composable
private fun SummaryCard(card: TaskBoardCard, rows: Int, onOpenSession: (String) -> Unit, modifier: Modifier) {
    val lead = card.sessions.firstOrNull()
    val shape = RoundedCornerShape(22.dp)
    Column(
        modifier
            .clip(shape)
            .background(MaterialTheme.workColors.card2)
            .then(if (rows == 0 && lead != null) Modifier.springClickable(highlight = shape) { onOpenSession(lead.id) }.testTag("newSession.boardCard") else Modifier)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            if (card.isConversation) stringResource(Res.string.work_conversation) else card.name,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (rows > 0) {
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                card.sessions.take(rows).forEach { session ->
                    BoardSessionChip(
                        session,
                        lineLimit = 1,
                        modifier = Modifier.springClickable(pressedScale = 0.96f, highlight = RoundedCornerShape(12.dp)) { onOpenSession(session.id) },
                    )
                }
            }
        } else {
            Text(workSessionTitle(lead?.title), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.weight(1f))
        Badge(card)
    }
}

@Composable
private fun Badge(card: TaskBoardCard) {
    val round = Modifier.size(32.dp).clip(CircleShape).background(MaterialTheme.colorScheme.background.copy(alpha = 0.6f))
    when {
        card.waiting > 0 -> CountBadge(RemoteSessionStatus.WaitingInput, card.waiting, round)
        card.running > 0 -> CountBadge(RemoteSessionStatus.Running, card.running, round)
        else ->
            Box(round, contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Check, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
            }
    }
}

/** A status glyph with how many sessions are in it; `glyphModifier` sets the glyph in a circle. */
@Composable
private fun CountBadge(status: RemoteSessionStatus, count: Int, glyphModifier: Modifier = Modifier) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(glyphModifier, contentAlignment = Alignment.Center) { StatusGlyph(status, size = 14.dp) }
        Text("$count", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
    }
}
