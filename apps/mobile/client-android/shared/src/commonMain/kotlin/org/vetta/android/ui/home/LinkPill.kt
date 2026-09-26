package org.vetta.android.ui.home

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Laptop
import androidx.compose.material.icons.outlined.LaptopChromebook
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.link.DesktopLink
import org.vetta.android.domain.remote.link.LinkIndicator
import org.vetta.android.domain.remote.link.LinkSnapshot
import org.vetta.android.domain.work.UnlinkReason
import org.vetta.android.resources.Res
import org.vetta.android.resources.link_reconnect
import org.vetta.android.resources.link_status
import org.vetta.android.resources.link_unauthorized
import org.vetta.android.resources.link_unknown_pairing
import org.vetta.android.resources.unlinked_pill
import org.vetta.android.resources.work_unpaired_title
import org.vetta.android.ui.design.GlassCapsuleButton
import org.vetta.android.ui.design.VettaMotion
import org.vetta.android.ui.design.springClickable
import org.vetta.android.ui.design.springContentSize
import org.vetta.android.ui.work.describe
import org.vetta.android.ui.work.linkDetail
import org.vetta.android.ui.work.workColors

/** The pill's look: unpaired, or the link's state. */
private sealed interface PillPhase {
    data object Unpaired : PillPhase

    data class Link(val indicator: LinkIndicator) : PillPhase
}

/**
 * The computer and how the phone reaches it, as a capsule (the iPhone's `LinkPill`):
 * black with a tick while online, spinning while connecting, red with a cross once the
 * link has failed. Its colour, mark and width morph from one state to the next. Tapping
 * explains the link and, offline, offers a reconnect; unpaired, it opens pairing.
 */
@Composable
fun LinkPill(
    paired: Boolean,
    link: LinkSnapshot,
    onReconnect: () -> Unit,
    onPair: () -> Unit,
    modifier: Modifier = Modifier,
    /** Set after an unpairing: the sessions shown no longer sync. */
    unlinked: UnlinkReason? = null,
) {
    val colors = MaterialTheme.workColors
    val phase: PillPhase = if (paired) PillPhase.Link(LinkIndicator.of(link)) else PillPhase.Unpaired
    val offline = phase == PillPhase.Link(LinkIndicator.Offline)
    val online = phase == PillPhase.Link(LinkIndicator.Online)
    var open by remember { mutableStateOf(false) }
    val fill by animateColorAsState(
        when {
            online -> colors.pill
            offline -> colors.red.copy(alpha = 0.18f)
            else -> colors.card2
        },
        VettaMotion.snappy(),
        label = "pill fill",
    )
    val ink by animateColorAsState(
        when {
            online -> colors.pillInk
            offline -> colors.red
            else -> colors.ink2
        },
        VettaMotion.snappy(),
        label = "pill ink",
    )
    val description =
        when {
            phase is PillPhase.Link -> describe(phase.indicator)
            unlinked != null -> stringResource(Res.string.unlinked_pill)
            else -> stringResource(Res.string.work_unpaired_title)
        }
    val label = stringResource(Res.string.link_status)
    Box(modifier) {
        Row(
            Modifier
                .height(40.dp)
                .clip(CircleShape)
                .background(fill)
                .springClickable(highlight = CircleShape) { if (paired) open = true else onPair() }
                .semantics {
                    contentDescription = label
                    stateDescription = description
                }.padding(horizontal = 16.dp)
                .springContentSize()
                .testTag("link.status"),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Icon(if (offline) Icons.Outlined.LaptopChromebook else Icons.Filled.Laptop, contentDescription = null, tint = ink, modifier = Modifier.size(20.dp))
            AnimatedContent(
                phase,
                transitionSpec = { (fadeIn(VettaMotion.snappy()) + scaleIn(VettaMotion.bouncy(), 0.6f)) togetherWith (fadeOut(VettaMotion.snappy()) + scaleOut(VettaMotion.snappy(), 0.6f)) },
                contentAlignment = Alignment.Center,
                label = "pill mark",
            ) { shown ->
                when (shown) {
                    PillPhase.Unpaired -> Icon(Icons.Filled.Add, contentDescription = null, tint = ink, modifier = Modifier.size(18.dp))
                    PillPhase.Link(LinkIndicator.Online) -> Icon(Icons.Filled.Check, contentDescription = null, tint = colors.green, modifier = Modifier.size(18.dp))
                    PillPhase.Link(LinkIndicator.Offline) -> Icon(Icons.Filled.Close, contentDescription = null, tint = ink, modifier = Modifier.size(18.dp))
                    else -> CircularProgressIndicator(Modifier.size(14.dp), color = ink, strokeWidth = 2.dp)
                }
            }
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            Column(Modifier.widthIn(min = 200.dp, max = 280.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(description, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    if (online) linkDetail(link)?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    if (link.lastError == DesktopLink.UNAUTHORIZED) {
                        Text(stringResource(Res.string.link_unauthorized), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    // The computer no longer knows this pairing: most likely unpaired there.
                    if (offline && link.lastError == DesktopLink.UNKNOWN_PAIRING) {
                        Text(stringResource(Res.string.link_unknown_pairing), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (offline) {
                    GlassCapsuleButton(
                        text = stringResource(Res.string.link_reconnect),
                        prominent = true,
                        height = 44.dp,
                        tag = "link.reconnect",
                        onClick = {
                            onReconnect()
                            open = false
                        },
                    )
                }
            }
        }
    }
}
