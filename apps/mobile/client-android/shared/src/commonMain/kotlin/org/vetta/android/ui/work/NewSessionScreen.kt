package org.vetta.android.ui.work

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.link.LinkIndicator
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.domain.work.ModelChoice
import org.vetta.android.domain.work.ProjectScope
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.domain.work.SessionStatusGroup
import org.vetta.android.domain.work.TaskBoard
import org.vetta.android.resources.Res
import org.vetta.android.resources.chat_composer_placeholder
import org.vetta.android.resources.chat_model
import org.vetta.android.resources.new_session_default_model
import org.vetta.android.resources.new_session_greeting
import org.vetta.android.resources.new_session_location
import org.vetta.android.resources.new_session_subtitle
import org.vetta.android.resources.new_session_title
import org.vetta.android.resources.work_conversation
import org.vetta.android.ui.board.BoardSummary
import org.vetta.android.ui.design.GlassSurface
import org.vetta.android.ui.design.VettaMotion
import org.vetta.android.ui.design.springClickable
import org.vetta.android.ui.home.LinkPill
import org.vetta.android.ui.home.ProjectIcon
import org.vetta.android.ui.home.ProjectSheet
import org.vetta.android.ui.shell.DrawerButton

/**
 * The root slot with no session in it (the iPhone's `NewSessionView`): a blank page for
 * starting one in a conversation or a project. Two large lines greet at the top left
 * over a violet-to-blue wash; the task board in brief waits at the bottom and steps
 * aside while typing. Until the desktop answers, the link pill stands where the composer
 * goes. Sending opens the chat at once; the desktop creates the session behind it.
 */
@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
fun NewSessionScreen(
    state: MirrorState,
    draft: PromptDraft,
    onDraftChange: (PromptDraft) -> Unit,
    /** `null` starts in the desktop's conversations. */
    initialProjectCwd: String?,
    /** What a failed start had, put back so nothing typed or chosen is lost. */
    restored: NewSessionStart?,
    onPrepare: suspend () -> Unit,
    onStart: (NewSessionStart) -> Unit,
    onOpenHome: () -> Unit,
    onClearError: () -> Unit,
    onOpenBoard: () -> Unit = {},
    onOpenSession: (String) -> Unit = {},
    onReconnect: () -> Unit = {},
    onPair: () -> Unit = {},
    onRefreshProjects: suspend () -> Unit = {},
) {
    var projectCwd by rememberSaveable { mutableStateOf(restored?.projectCwd ?: initialProjectCwd) }
    // Starts on what was used last on this desktop; empty keeps the desktop's default model and level.
    val initial = restored?.modelChoice ?: state.lastModelChoice.available(state.newSessionModels)
    var modelKey by rememberSaveable { mutableStateOf(initial.modelKey) }
    var thinkingLevel by rememberSaveable { mutableStateOf(initial.thinkingLevel) }
    val choice = ModelChoice(modelKey, thinkingLevel)
    // A remembered model the desktop has since dropped falls back to its default.
    LaunchedEffect(state.newSessionModels) {
        val kept = ModelChoice(modelKey, thinkingLevel).available(state.newSessionModels)
        modelKey = kept.modelKey
        thinkingLevel = kept.thinkingLevel
    }
    val offline = LinkIndicator.of(state.link) == LinkIndicator.Offline
    val cards = remember(state.sessions, state.conversationCwd) { TaskBoard.cards(state.sessions, state.conversationCwd) }
    val keyboardUp = WindowInsets.isImeVisible
    // The board's summary needs the height of a phone held upright; sideways it would be crushed.
    val tallEnough = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.height.toDp() } >= SUMMARY_MIN_WINDOW_HEIGHT
    val focus = LocalFocusManager.current

    LaunchedEffect(restored) { restored?.let { onDraftChange(it.draft) } }
    LaunchedEffect(state.online) { if (state.online) onPrepare() }

    Box(Modifier.fillMaxSize().testTag("newSession")) {
        WelcomeBackdrop()
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 16.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                DrawerButton(onOpenHome)
                ModelMenu(state, choice) { next ->
                    modelKey = next.modelKey
                    thinkingLevel = next.thinkingLevel
                }
            }
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .springClickable(pressedScale = 1f, role = null) { focus.clearFocus() }
                    .padding(horizontal = 24.dp)
                    .padding(top = 12.dp, bottom = 12.dp),
            ) {
                // With nothing on the board the avatar has no header to sit in; it greets from the top.
                if (cards.isEmpty()) {
                    BotAvatar(size = 40.dp, asleep = offline)
                    Spacer(Modifier.height(18.dp))
                }
                Greeting()
                LocationChip(state, projectCwd, onRefreshProjects, Modifier.padding(top = 18.dp)) { projectCwd = it }
                Spacer(Modifier.weight(1f))
                // Typing is about the new session; the board steps aside for the keyboard.
                AnimatedVisibility(
                    !keyboardUp && tallEnough,
                    enter = fadeIn(VettaMotion.snappy()) + expandVertically(VettaMotion.snappy()),
                    exit = fadeOut(VettaMotion.snappy()) + shrinkVertically(VettaMotion.snappy()),
                ) {
                    BoardSummary(
                        cards = cards,
                        waiting = state.count(SessionStatusGroup.Waiting),
                        running = state.count(SessionStatusGroup.Processing),
                        online = state.online,
                        avatarAsleep = offline,
                        onOpenSession = onOpenSession,
                        onOpenBoard = onOpenBoard,
                        modifier = Modifier.padding(bottom = 14.dp),
                    )
                }
            }
            AnimatedContent(
                state.online,
                transitionSpec = { fadeIn(VettaMotion.snappy()) togetherWith fadeOut(VettaMotion.snappy()) },
                contentAlignment = Alignment.BottomCenter,
                label = "composer or link",
            ) { online ->
                if (online) {
                    Composer(
                        draft = draft,
                        onDraftChange = onDraftChange,
                        placeholder = stringResource(Res.string.chat_composer_placeholder),
                        onSend = { sent -> onStart(NewSessionStart(sent, projectCwd, choice)) },
                        containerColor = Color.Transparent,
                    )
                } else {
                    Box(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp), contentAlignment = Alignment.Center) {
                        LinkPill(state.paired, state.link, onReconnect, onPair, unlinked = state.unlinked)
                    }
                }
            }
        }
    }
    MirrorErrorDialog(state.lastError, onClearError)
}

/** Two large lines at the top left, the second lit in the backdrop's colours. */
@Composable
private fun Greeting() {
    val colors = MaterialTheme.workColors
    val greeting = stringResource(Res.string.new_session_greeting)
    val subtitle = stringResource(Res.string.new_session_subtitle)
    val style = TextStyle(fontSize = 34.sp, lineHeight = 40.sp, fontWeight = FontWeight.SemiBold)
    Column(Modifier.semantics(mergeDescendants = true) { heading() }) {
        Text(greeting, style = style)
        Text(subtitle, style = style.copy(brush = Brush.linearGradient(listOf(colors.greetingStart, colors.greetingEnd))))
    }
}

/** Where the chat keeps its model, so both pages switch it in the same place. */
@Composable
private fun ModelMenu(state: MirrorState, choice: ModelChoice, onChoose: (ModelChoice) -> Unit) {
    val options = state.newSessionModels
    var picking by remember { mutableStateOf(false) }
    val name = options.firstOrNull { it.key == choice.modelKey }?.name ?: stringResource(Res.string.new_session_default_model)
    val text = choice.thinkingLevel?.let { "$name · ${levelLabel(it)}" } ?: name
    val label = stringResource(Res.string.chat_model)
    // A kept list can still be browsed offline; the sheet waits for one that is on its way.
    ModelTitle(
        title = stringResource(Res.string.new_session_title),
        detail = text,
        online = state.online,
        picks = options.isNotEmpty(),
        enabled = state.online || options.isNotEmpty(),
        onClick = { picking = true },
        description = "$label: $text",
        modifier = Modifier.testTag("newSession.model"),
    )
    if (picking) ModelSheet(options, choice, onChoose, onDismiss = { picking = false }, offersDefault = true)
}

/** A glass chip naming where the session will start; it opens the project sheet. */
@Composable
private fun LocationChip(
    state: MirrorState,
    projectCwd: String?,
    onRefreshProjects: suspend () -> Unit,
    modifier: Modifier = Modifier,
    onChoose: (String?) -> Unit,
) {
    var picking by remember { mutableStateOf(false) }
    val name =
        projectCwd?.let { cwd ->
            state.projects.firstOrNull { it.cwd == cwd }?.name
                ?: state.sessions.firstOrNull { it.projectCwd == cwd }?.projectName
                ?: cwd.trimEnd('/', '\\').substringAfterLast('/').substringAfterLast('\\')
        } ?: stringResource(Res.string.work_conversation)
    val label = stringResource(Res.string.new_session_location)
    GlassSurface(
        modifier
            .height(40.dp)
            .springClickable(highlight = CircleShape) { picking = true }
            .semantics { contentDescription = "$label: $name" }
            .testTag("newSession.location"),
        shape = CircleShape,
    ) {
        Row(Modifier.padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(if (projectCwd == null) Icons.Outlined.ChatBubbleOutline else ProjectIcon, contentDescription = null, modifier = Modifier.size(16.dp))
            Text(name, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 200.dp))
            Icon(Icons.Filled.UnfoldMore, contentDescription = null, modifier = Modifier.size(14.dp))
        }
    }
    if (picking) {
        ProjectSheet(
            state = state,
            selection = projectCwd?.let(ProjectScope::Project) ?: ProjectScope.Conversations,
            onPick = { scope -> onChoose((scope as? ProjectScope.Project)?.cwd) },
            onDismiss = { picking = false },
            onRefreshProjects = onRefreshProjects,
        )
    }
}

/**
 * A violet-to-blue wash over the top of the page that fades into the background by the
 * middle, so the board and the composer sit on the plain page; toned down in light mode.
 * It fades in once as the page opens, after the first frames have settled so the
 * animation is not spent while the app is still busy starting, and then holds still.
 */
@Composable
private fun WelcomeBackdrop() {
    val colors = MaterialTheme.workColors
    val page = MaterialTheme.colorScheme.background
    val strength = if (page.luminance() < 0.5f) 1f else 0.35f
    val lit = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        repeat(6) { withFrameNanos { } }
        lit.animateTo(1f, tween(800, easing = FastOutSlowInEasing))
    }
    Box(
        Modifier
            .fillMaxSize()
            .background(page)
            .drawBehind {
                val alpha = lit.value * strength
                if (alpha <= 0f) return@drawBehind
                drawRect(
                    Brush.linearGradient(listOf(colors.welcomeViolet, colors.welcomeBlue), start = Offset.Zero, end = Offset(size.width, size.height * 0.25f)),
                    alpha = alpha,
                    size = size.copy(height = size.height * 0.5f),
                )
                // The wash fades out into the page by the middle.
                drawRect(
                    Brush.verticalGradient(0f to page.copy(alpha = 0f), 0.22f to page.copy(alpha = 0.3f), 0.5f to page, endY = size.height),
                    size = size.copy(height = size.height * 0.5f),
                )
            },
    )
}

/** The window height below which New Session leaves the board's summary out. */
private val SUMMARY_MIN_WINDOW_HEIGHT = 560.dp
