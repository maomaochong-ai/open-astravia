package org.vetta.android.ui.remote

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.runner.RunWith
import org.vetta.android.app.ThemeMode
import org.vetta.android.domain.remote.RemoteDeviceStatus
import org.vetta.android.domain.remote.link.LinkChannel
import org.vetta.android.domain.remote.link.LinkSnapshot
import org.vetta.android.domain.remote.link.LinkStatus
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.resources.Res
import org.vetta.android.resources.remote_control_not_allowed
import org.vetta.android.ui.str
import org.vetta.android.ui.theme.VettaTheme
import kotlin.test.Test

@RunWith(AndroidJUnit4::class)
class RemoteDesktopScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun saysWhereToTurnRemoteControlOnWhenTheDesktopHasItOffForThisPhone() {
        val status = RemoteDeviceStatus("Mac", null, emptyList(), true, 0, desktopControl = false)
        val state = MirrorState(paired = true, link = LinkSnapshot(LinkStatus.Online, LinkChannel.Lan, peerOnline = true, desktop = status))
        composeRule.setContent {
            VettaTheme(ThemeMode.Dark) {
                RemoteDesktopScreen(state, viewerUrl = "wss://relay.example/v2/desktop/aaaaaaaaaaaaaaaa/viewer", onClose = {})
            }
        }
        composeRule.onNodeWithTag("remote.unavailable").assertTextEquals(str(Res.string.remote_control_not_allowed))
    }
}
