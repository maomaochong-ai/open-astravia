package org.astravia.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.tooling.preview.Preview
import org.astravia.android.app.AppContainer
import org.astravia.android.domain.work.IncomingShare
import org.astravia.android.domain.work.LaunchTarget
import org.astravia.android.ui.LocalAppContainer
import org.astravia.android.ui.RootApp

@Composable
@Preview
fun App(
    container: AppContainer = remember { AppContainer.createDefault() },
    pairingInvite: String? = null,
    onPairingInviteHandled: () -> Unit = {},
    incomingShare: IncomingShare? = null,
    onShareHandled: () -> Unit = {},
    openSession: String? = null,
    onOpenSessionHandled: () -> Unit = {},
    launchTarget: LaunchTarget? = null,
    onLaunchTargetHandled: () -> Unit = {},
) {
    CompositionLocalProvider(LocalAppContainer provides container) {
        RootApp(
            container = container,
            pairingInvite = pairingInvite,
            onPairingInviteHandled = onPairingInviteHandled,
            incomingShare = incomingShare,
            onShareHandled = onShareHandled,
            openSession = openSession,
            onOpenSessionHandled = onOpenSessionHandled,
            launchTarget = launchTarget,
            onLaunchTargetHandled = onLaunchTargetHandled,
        )
    }
}
