package org.vetta.android.ui.pairing

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.pairing.PairingPhase
import org.vetta.android.resources.Res
import org.vetta.android.resources.cancel
import org.vetta.android.resources.pair_code_hint
import org.vetta.android.resources.pair_connecting
import org.vetta.android.resources.pair_manual
import org.vetta.android.resources.pair_scan
import org.vetta.android.resources.pair_scan_hint
import org.vetta.android.resources.pair_title
import org.vetta.android.resources.pair_troubleshoot
import org.vetta.android.resources.pair_troubleshoot_firewall
import org.vetta.android.resources.pair_troubleshoot_relay
import org.vetta.android.resources.pair_troubleshoot_same_wifi
import org.vetta.android.resources.pair_verification_code
import org.vetta.android.resources.pair_waiting_approval
import org.vetta.android.resources.work_unpaired_description
import org.vetta.android.resources.work_unpaired_scan
import org.vetta.android.resources.work_unpaired_title
import org.vetta.android.ui.PairingError
import org.vetta.android.ui.design.GlassCapsuleButton
import org.vetta.android.ui.design.GlassSurface
import org.vetta.android.ui.design.VettaMotion
import org.vetta.android.ui.design.VettaSheet
import org.vetta.android.ui.design.springClickable
import org.vetta.android.ui.design.springContentSize
import org.vetta.android.ui.i18n.resolve
import org.vetta.android.ui.remote.rememberPairingScanner
import org.vetta.android.ui.work.BotAvatar
import org.vetta.android.ui.work.ManualPairDialog
import org.vetta.android.ui.work.workColors

/**
 * Pairing, as a sheet over whatever is showing (the iPhone's `PairView`): the scan frame
 * opens the camera, and the page follows the pairing as it goes: connecting, then the
 * code to check on the computer, or why it failed. Typing the computer's address is the
 * way in when scanning is not possible. Closing the sheet stops a pairing under way.
 */
@Composable
fun PairingSheet(
    phase: PairingPhase,
    connecting: Boolean,
    error: PairingError?,
    onScanned: (String) -> Unit,
    onManual: (String) -> Unit,
    onCancelPairing: () -> Unit,
    onDismiss: () -> Unit,
) {
    var manualOpen by remember { mutableStateOf(false) }
    var helpOpen by remember { mutableStateOf(false) }
    val scan = rememberPairingScanner(onScanned)
    val waiting = phase as? PairingPhase.AwaitingApproval
    VettaSheet(onDismiss = onDismiss, title = stringResource(Res.string.pair_title), expanded = true) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(horizontal = 24.dp, vertical = 8.dp)
                .springContentSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            ScanFrame(active = !connecting && waiting == null, onClick = scan, modifier = Modifier.padding(top = 16.dp))
            AnimatedContent(
                waiting,
                transitionSpec = { fadeIn(VettaMotion.snappy()) togetherWith fadeOut(VettaMotion.snappy()) },
                contentAlignment = Alignment.TopCenter,
                label = "pairing step",
            ) { approval ->
                if (approval != null) {
                    VerificationCode(approval.verificationCode, onCancelPairing)
                } else {
                    Column(Modifier.padding(top = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(stringResource(Res.string.pair_scan_hint), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                        Text(
                            stringResource(Res.string.work_unpaired_description),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                        )
                    }
                }
            }
            AnimatedVisibility(connecting && waiting == null, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
                GlassSurface(Modifier.padding(top = 20.dp), shape = RoundedCornerShape(50)) {
                    Row(Modifier.padding(horizontal = 14.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CircularProgressIndicator(Modifier.size(14.dp), color = MaterialTheme.workColors.green, strokeWidth = 2.dp)
                        Text(stringResource(Res.string.pair_connecting), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.workColors.ink2)
                    }
                }
            }
            AnimatedVisibility(error != null && !connecting, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
                error?.let {
                    Text(
                        it.message.resolve(),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.workColors.red,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 16.dp).testTag("pair.error"),
                    )
                }
            }
            Spacer(Modifier.height(32.dp))
            GlassCapsuleButton(
                text = stringResource(Res.string.pair_scan),
                icon = Icons.Filled.QrCodeScanner,
                prominent = true,
                enabled = !connecting,
                onClick = scan,
                modifier = Modifier.fillMaxWidth(),
                tag = "pair.scan",
            )
            GlassCapsuleButton(
                text = stringResource(Res.string.pair_manual),
                icon = Icons.Filled.Keyboard,
                enabled = !connecting,
                onClick = { manualOpen = true },
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                tag = "pair.manual",
            )
            Row(
                Modifier.padding(top = 16.dp).springClickable { helpOpen = !helpOpen }.padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(stringResource(Res.string.pair_troubleshoot), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(14.dp))
            }
            AnimatedVisibility(helpOpen, enter = fadeIn() + expandVertically(VettaMotion.snappy()), exit = fadeOut() + shrinkVertically(VettaMotion.snappy())) {
                Column(Modifier.padding(top = 4.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    listOf(Res.string.pair_troubleshoot_same_wifi, Res.string.pair_troubleshoot_firewall, Res.string.pair_troubleshoot_relay).forEach { tip ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("•", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(stringResource(tip), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
    if (manualOpen) {
        ManualPairDialog(
            onConnect = { endpoint ->
                manualOpen = false
                onManual(endpoint)
            },
            onDismiss = { manualOpen = false },
        )
    }
}

/**
 * The computer asks its user to allow this phone: both screens show the same code, so
 * the person can tell it is their computer. Cancelling stops the pairing.
 */
@Composable
private fun VerificationCode(code: String?, onCancel: () -> Unit) {
    Column(Modifier.padding(top = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(stringResource(Res.string.pair_verification_code), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (code != null) {
            Text(code, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 40.sp, letterSpacing = 8.sp, modifier = Modifier.testTag("pair.code"))
        }
        Text(stringResource(Res.string.pair_waiting_approval), style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
        Text(stringResource(Res.string.pair_code_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        TextButton(onClick = onCancel, modifier = Modifier.testTag("pair.cancel")) { Text(stringResource(Res.string.cancel)) }
    }
}

/**
 * The viewfinder: white-on-ink corner brackets around a QR glyph with a scan line
 * sweeping down while it waits; a tap opens the camera.
 */
@Composable
private fun ScanFrame(active: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = MaterialTheme.workColors
    val sweep by rememberInfiniteTransition(label = "scan").animateFloat(0.08f, 0.92f, infiniteRepeatable(tween(1_800, easing = LinearEasing), RepeatMode.Reverse), label = "scan line")
    GlassSurface(
        modifier.size(220.dp).springClickable(enabled = active, highlight = RoundedCornerShape(36.dp), onClick = onClick).testTag("pair.frame"),
        shape = RoundedCornerShape(36.dp),
    ) {
        Icon(Icons.Filled.QrCode2, contentDescription = null, tint = colors.faint.copy(alpha = 0.5f), modifier = Modifier.size(96.dp))
        val ink = MaterialTheme.colorScheme.onSurface
        val line = colors.green
        Canvas(Modifier.fillMaxSize().padding(22.dp)) {
            val arm = size.minDimension * 0.22f
            val stroke = Stroke(width = 4.dp.toPx(), cap = StrokeCap.Round)
            val w = size.width
            val h = size.height
            listOf(
                Offset(0f, 0f) to Pair(Offset(arm, 0f), Offset(0f, arm)),
                Offset(w, 0f) to Pair(Offset(w - arm, 0f), Offset(w, arm)),
                Offset(0f, h) to Pair(Offset(arm, h), Offset(0f, h - arm)),
                Offset(w, h) to Pair(Offset(w - arm, h), Offset(w, h - arm)),
            ).forEach { (corner, ends) ->
                drawLine(ink, corner, ends.first, stroke.width, stroke.cap)
                drawLine(ink, corner, ends.second, stroke.width, stroke.cap)
            }
            if (active) {
                val y = h * sweep
                drawRoundRect(
                    Brush.horizontalGradient(listOf(line.copy(alpha = 0f), line, line.copy(alpha = 0f))),
                    topLeft = Offset(w * 0.08f, y - 1.5.dp.toPx()),
                    size = Size(w * 0.84f, 3.dp.toPx()),
                    cornerRadius = CornerRadius(2.dp.toPx()),
                )
            }
        }
    }
}

/** Shown in place of New Session until a desktop is paired. */
@Composable
fun UnpairedView(onPair: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        BotAvatar(size = 56.dp, asleep = true)
        Text(
            stringResource(Res.string.work_unpaired_title),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(top = 24.dp),
        )
        Text(
            stringResource(Res.string.work_unpaired_description),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp),
        )
        GlassCapsuleButton(
            text = stringResource(Res.string.work_unpaired_scan),
            icon = Icons.Filled.QrCodeScanner,
            prominent = true,
            onClick = onPair,
            modifier = Modifier.padding(top = 28.dp),
            tag = "home.pair",
        )
    }
}
