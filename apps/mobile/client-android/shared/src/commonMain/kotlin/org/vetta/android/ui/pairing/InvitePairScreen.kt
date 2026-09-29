package org.vetta.android.ui.pairing

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.outlined.Laptop
import androidx.compose.material.icons.outlined.PhonelinkRing
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.pairing.InviteLookup
import org.vetta.android.domain.remote.protocol.InviteCode
import org.vetta.android.resources.Res
import org.vetta.android.resources.back
import org.vetta.android.resources.close
import org.vetta.android.resources.pair_connect
import org.vetta.android.resources.pair_invite_code
import org.vetta.android.resources.pair_invite_code_hint
import org.vetta.android.resources.pair_invite_code_title
import org.vetta.android.resources.pair_invite_edit_code
import org.vetta.android.resources.pair_invite_next
import org.vetta.android.resources.pair_invite_password
import org.vetta.android.resources.pair_invite_password_hint
import org.vetta.android.resources.pair_invite_password_title
import org.vetta.android.resources.pair_invite_relay
import org.vetta.android.resources.pair_invite_relay_toggle
import org.vetta.android.ui.PairingError
import org.vetta.android.ui.i18n.resolve
import org.vetta.android.ui.theme.vettaExtra
import org.vetta.android.ui.work.workColors
import kotlin.math.PI
import kotlin.math.roundToInt
import kotlin.math.sin

private enum class InviteStep { Code, Password }

/**
 * Pairing with the connection code and password the computer shows next to its QR code
 * (ADR-0136), one step at a time as on the iPhone: eight boxes for the code, then six for
 * the password. A full code moves on by itself and a full password connects; what went
 * wrong sends the user back to the step that needs fixing. The picture on top follows
 * along, answering what is typed rather than playing on its own.
 */
@Composable
fun InvitePairScreen(
    connecting: Boolean,
    error: PairingError?,
    /** Why the last code led nowhere, to choose the step to go back to; null for other failures. */
    failure: InviteLookup?,
    onConnect: (code: String, password: String, relayBaseUrl: String?) -> Unit,
    onDismiss: () -> Unit,
) {
    var step by remember { mutableStateOf(InviteStep.Code) }
    var code by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var ownRelay by remember { mutableStateOf(false) }
    var relay by remember { mutableStateOf("") }
    var shown by remember { mutableStateOf<String?>(null) }
    var submitted by remember { mutableStateOf(false) }
    var failures by remember { mutableIntStateOf(0) }
    val codeFocus = remember { FocusRequester() }
    val passwordFocus = remember { FocusRequester() }
    val haptics = LocalHapticFeedback.current
    val errorText = error?.message?.resolve()

    fun advance() {
        if (code.length != InviteCode.CODE_LENGTH) return
        shown = null
        step = InviteStep.Password
    }

    fun back() {
        shown = null
        password = ""
        step = InviteStep.Code
    }

    fun submit() {
        val normalized = InviteCode.normalize(code) ?: return
        if (connecting || !InviteCode.isValidPassword(password)) return
        submitted = true
        onConnect(normalized, password, relay.trim().takeIf { ownRelay && it.isNotEmpty() })
    }

    // A finished attempt that did not pair says what went wrong where it can be fixed: an
    // unknown code on the code step, a wrong password cleared for another try.
    LaunchedEffect(connecting, errorText) {
        if (connecting || !submitted || errorText == null) return@LaunchedEffect
        submitted = false
        shown = errorText
        failures += 1
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        if (failure == InviteLookup.WrongPassword || failure == InviteLookup.NotFound) password = ""
        if (failure == InviteLookup.NotFound) step = InviteStep.Code
    }
    LaunchedEffect(step) { (if (step == InviteStep.Code) codeFocus else passwordFocus).requestFocus() }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(MaterialTheme.vettaExtra.pageBackground).statusBarsPadding().navigationBarsPadding().imePadding().testTag("pair.invite.screen")) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(top = 56.dp, bottom = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                InviteHero(step, code.length, password.length, connecting, failures)
                AnimatedContent(
                    step,
                    transitionSpec = {
                        val forward = targetState == InviteStep.Password
                        (slideInHorizontally { if (forward) it else -it } + fadeIn()) togetherWith (slideOutHorizontally { if (forward) -it else it } + fadeOut())
                    },
                    label = "invite step",
                ) { current ->
                    Column(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        if (current == InviteStep.Code) {
                            Heading(stringResource(Res.string.pair_invite_code_title), stringResource(Res.string.pair_invite_code_hint))
                            CodeBoxes(
                                value = code,
                                onValueChange = { typed ->
                                    code = InviteCode.typed(typed)
                                    if (code.isNotEmpty()) shown = null
                                    if (code.length == InviteCode.CODE_LENGTH) advance()
                                },
                                length = InviteCode.CODE_LENGTH,
                                split = InviteCode.CODE_LENGTH / 2,
                                failed = shown != null,
                                shakes = failures,
                                numeric = false,
                                focus = codeFocus,
                                label = stringResource(Res.string.pair_invite_code),
                                tag = "pair.invite.code",
                            )
                            ErrorLine(shown)
                            RelayOption(ownRelay, relay, onToggle = { ownRelay = !ownRelay }, onRelay = { relay = it })
                            ActionButton(stringResource(Res.string.pair_invite_next), enabled = code.length == InviteCode.CODE_LENGTH, busy = false, tag = "pair.invite.next", onClick = ::advance)
                        } else {
                            Heading(stringResource(Res.string.pair_invite_password_title), stringResource(Res.string.pair_invite_password_hint))
                            Row(Modifier.padding(bottom = 20.dp).offset(y = (-12).dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(InviteCode.format(code), fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = MaterialTheme.workColors.ink2)
                                Text(
                                    stringResource(Res.string.pair_invite_edit_code),
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = MaterialTheme.workColors.blue,
                                    modifier = Modifier.clip(RoundedCornerShape(6.dp)).combinedClickable(onClick = ::back).padding(4.dp).testTag("pair.invite.editCode"),
                                )
                            }
                            CodeBoxes(
                                value = password,
                                onValueChange = { typed ->
                                    password = typed.filter { it in '0'..'9' }.take(InviteCode.PASSWORD_LENGTH)
                                    if (password.isNotEmpty()) shown = null
                                    if (password.length == InviteCode.PASSWORD_LENGTH) submit()
                                },
                                length = InviteCode.PASSWORD_LENGTH,
                                split = null,
                                failed = shown != null,
                                shakes = failures,
                                numeric = true,
                                focus = passwordFocus,
                                label = stringResource(Res.string.pair_invite_password),
                                tag = "pair.invite.password",
                            )
                            ErrorLine(shown)
                            ActionButton(
                                stringResource(Res.string.pair_connect),
                                enabled = !connecting && password.length == InviteCode.PASSWORD_LENGTH,
                                busy = connecting,
                                tag = "pair.invite.connect",
                                onClick = ::submit,
                            )
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)) {
                if (step == InviteStep.Password) {
                    IconButton(onClick = ::back, modifier = Modifier.testTag("pair.invite.back")) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.back))
                    }
                }
                Box(Modifier.weight(1f))
                IconButton(onClick = onDismiss, modifier = Modifier.testTag("pair.invite.close")) {
                    Icon(Icons.Filled.Close, contentDescription = stringResource(Res.string.close))
                }
            }
        }
    }
}

@Composable
private fun Heading(title: String, hint: String) {
    Column(Modifier.fillMaxWidth().padding(bottom = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, fontSize = 26.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        Text(hint, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.vettaExtra.secondaryText, textAlign = TextAlign.Center)
    }
}

/**
 * One box per character over a field nobody sees: the keyboard types into the field, the
 * boxes show what it holds, a tap brings the keyboard back and a long press pastes.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun CodeBoxes(
    value: String,
    onValueChange: (String) -> Unit,
    length: Int,
    split: Int?,
    failed: Boolean,
    shakes: Int,
    numeric: Boolean,
    focus: FocusRequester,
    label: String,
    tag: String,
) {
    var focused by remember { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current
    val clipboard = LocalClipboardManager.current
    val shake = remember { Animatable(0f) }
    LaunchedEffect(shakes) {
        if (shakes == 0) return@LaunchedEffect
        shake.snapTo(0f)
        shake.animateTo(1f, tween(400))
    }
    val colors = MaterialTheme.workColors
    val ink = MaterialTheme.colorScheme.onSurface
    Box(
        Modifier
            .fillMaxWidth()
            .offset { IntOffset((8.dp.toPx() * sin(shake.value * PI * 4)).roundToInt(), 0) }
            .combinedClickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = {
                    focus.requestFocus()
                    keyboard?.show()
                },
                onLongClick = { clipboard.getText()?.text?.let(onValueChange) },
            ),
        contentAlignment = Alignment.Center,
    ) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = TextStyle(color = ink.copy(alpha = 0f)),
            cursorBrush = SolidColor(ink.copy(alpha = 0f)),
            keyboardOptions =
                if (numeric) {
                    KeyboardOptions(keyboardType = KeyboardType.NumberPassword)
                } else {
                    KeyboardOptions(capitalization = KeyboardCapitalization.Characters, keyboardType = KeyboardType.Ascii, autoCorrectEnabled = false)
                },
            modifier =
                Modifier
                    .size(1.dp)
                    .alpha(0f)
                    .focusRequester(focus)
                    .onFocusChanged { focused = it.isFocused }
                    .semantics { contentDescription = label }
                    .testTag(tag),
        )
        // Boxes share the width, up to 52 dp each, so eight still fit a narrow phone.
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
            for (index in 0 until length) {
                if (index == split) Text("–", fontSize = 20.sp, color = colors.faint)
                val current = focused && index == value.length
                Box(
                    Modifier
                        .weight(1f)
                        .widthIn(max = 52.dp)
                        .height(54.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(MaterialTheme.colorScheme.surface)
                        .border(
                            if (current || failed) 1.5.dp else 1.dp,
                            when {
                                failed -> colors.red
                                current -> ink
                                else -> MaterialTheme.vettaExtra.border
                            },
                            RoundedCornerShape(12.dp),
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    val character = value.getOrNull(index)
                    if (character != null) {
                        Text(character.toString(), fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold, fontSize = 24.sp)
                    } else if (current) {
                        Box(Modifier.size(width = 2.dp, height = 22.dp).background(ink, CircleShape))
                    }
                }
            }
        }
    }
}

@Composable
private fun ErrorLine(text: String?) {
    AnimatedVisibility(text != null, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
        Text(
            text.orEmpty(),
            fontSize = 13.sp,
            color = MaterialTheme.workColors.red,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp).testTag("pair.invite.error"),
        )
    }
}

@Composable
private fun RelayOption(open: Boolean, relay: String, onToggle: () -> Unit, onRelay: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(
            Modifier.clip(RoundedCornerShape(8.dp)).combinedClickable(onClick = onToggle).padding(6.dp).testTag("pair.invite.ownRelay"),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(stringResource(Res.string.pair_invite_relay_toggle), fontSize = 13.sp, color = MaterialTheme.vettaExtra.secondaryText)
            Icon(if (open) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.vettaExtra.secondaryText)
        }
        AnimatedVisibility(open) {
            OutlinedTextField(
                value = relay,
                onValueChange = onRelay,
                label = { Text(stringResource(Res.string.pair_invite_relay)) },
                placeholder = { Text(InviteCode.DEFAULT_RELAY_BASE_URL) },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
                modifier = Modifier.fillMaxWidth().testTag("pair.invite.relay"),
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ActionButton(text: String, enabled: Boolean, busy: Boolean, tag: String, onClick: () -> Unit) {
    val colors = MaterialTheme.workColors
    Box(
        Modifier
            .padding(top = 24.dp)
            .fillMaxWidth()
            .height(52.dp)
            .clip(RoundedCornerShape(50))
            .background(colors.pill.copy(alpha = if (enabled || busy) 1f else 0.35f))
            .combinedClickable(enabled = enabled, onClick = onClick)
            .testTag(tag),
        contentAlignment = Alignment.Center,
    ) {
        if (busy) {
            CircularProgressIndicator(Modifier.size(20.dp), color = colors.pillInk, strokeWidth = 2.dp)
        } else {
            Text(text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = colors.pillInk)
        }
    }
}

/**
 * The picture over the steps: the computer and this phone join up dot by dot as the code
 * is typed, then a lock takes a knock per digit, breathes while connecting and shakes
 * when turned down.
 */
@Composable
private fun InviteHero(step: InviteStep, codeLength: Int, passwordLength: Int, connecting: Boolean, failures: Int) {
    val colors = MaterialTheme.workColors
    val ink = MaterialTheme.colorScheme.onSurface
    val knock = remember { Animatable(1f) }
    val wiggle = remember { Animatable(0f) }
    LaunchedEffect(codeLength, passwordLength) {
        if (codeLength == 0 && passwordLength == 0) return@LaunchedEffect
        knock.snapTo(0.88f)
        knock.animateTo(1f, spring(dampingRatio = 0.4f, stiffness = 900f))
    }
    LaunchedEffect(failures) {
        if (failures == 0) return@LaunchedEffect
        wiggle.snapTo(0f)
        wiggle.animateTo(0f, keyframes { durationMillis = 420; 8f at 70; -8f at 160; 5f at 250; -3f at 330 })
    }
    val breathe by rememberInfiniteTransition(label = "connecting").animateFloat(1f, 0.45f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "breathe")
    Box(Modifier.height(72.dp).fillMaxWidth().offset { IntOffset(wiggle.value.dp.roundToPx(), 0) }, contentAlignment = Alignment.Center) {
        AnimatedContent(step, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "hero") { current ->
            if (current == InviteStep.Code) {
                val complete = codeLength >= InviteCode.CODE_LENGTH
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Outlined.Laptop, contentDescription = null, modifier = Modifier.size(46.dp), tint = colors.ink2)
                    Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        for (index in 0 until InviteCode.CODE_LENGTH) {
                            Box(Modifier.size(5.dp).clip(CircleShape).background(if (index < codeLength) (if (complete) colors.green else ink) else MaterialTheme.vettaExtra.border))
                        }
                    }
                    Icon(
                        if (complete) Icons.Outlined.PhonelinkRing else Icons.Outlined.Smartphone,
                        contentDescription = null,
                        modifier = Modifier.size(40.dp).scale(knock.value),
                        tint = if (complete) colors.green else colors.ink2,
                    )
                }
            } else {
                Icon(
                    Icons.Filled.Lock,
                    contentDescription = null,
                    modifier = Modifier.size(52.dp).scale(knock.value).alpha(if (connecting) breathe else 1f),
                    tint = ink,
                )
            }
        }
    }
}
