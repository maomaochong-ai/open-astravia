package org.vetta.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.runner.RunWith
import org.vetta.android.app.ThemeMode
import org.vetta.android.domain.device.ConnectChannel
import org.vetta.android.domain.device.DesktopDevice
import org.vetta.android.domain.device.DeviceStatus
import org.vetta.android.ui.chat.ChatScreen
import org.vetta.android.ui.connect.DeviceDetailScreen
import org.vetta.android.ui.i18n.Str
import org.vetta.android.ui.navigation.ChatSurface
import org.vetta.android.ui.theme.VettaTheme
import kotlin.test.Test
import kotlin.test.assertTrue

@RunWith(AndroidJUnit4::class)
class DesktopConversationScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun desktopDetailShowsConnectedStateAndStartsConversation() {
        var started = false
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                DeviceDetailScreen(
                    device =
                        DesktopDevice(
                            id = "desktop-test",
                            name = "TEST-DESKTOP",
                            osLabel = "Android Emulator Relay",
                            host = "10.0.2.2",
                            status = DeviceStatus.Online,
                            channel = ConnectChannel.Remote,
                            latencyMs = 12,
                        ),
                    onBack = {},
                    onDisconnect = {},
                    onNewChat = { started = true },
                )
            }
        }

        composeRule.onNodeWithText("TEST-DESKTOP").assertIsDisplayed()
        composeRule.onNodeWithText(Str.deviceConnected).assertIsDisplayed()
        composeRule.onNodeWithText(Str.startConversation).performClick()
        assertTrue(started)
    }

    @Test
    fun desktopChatEnablesSendWithoutCloudModel() {
        var sent = false
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                ChatScreen(
                    title = "TEST-DESKTOP",
                    surface = ChatSurface.Desktop,
                    messages = emptyList(),
                    draft = "hello",
                    pendingImages = emptyList(),
                    isStreaming = false,
                    models = emptyList(),
                    selectedModel = null,
                    modelPickerOpen = false,
                    globalError = null,
                    onDraftChange = {},
                    onSend = { sent = true },
                    onStop = {},
                    onBack = {},
                    onOpenModelPicker = {},
                    onCloseModelPicker = {},
                    onSelectModel = {},
                    onErrorAction = {},
                    onDismissError = {},
                    onImagesPicked = {},
                    onRemovePendingImage = {},
                )
            }
        }

        composeRule.onNodeWithContentDescription(Str.send).assertIsEnabled().performClick()
        assertTrue(sent)
    }
}
