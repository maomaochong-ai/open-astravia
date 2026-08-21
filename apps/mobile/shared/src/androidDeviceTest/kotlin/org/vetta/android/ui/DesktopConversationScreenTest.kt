package org.vetta.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.runner.RunWith
import org.vetta.android.app.ThemeMode
import org.vetta.android.core.model.LlmModel
import org.vetta.android.core.model.ChatRole
import org.vetta.android.domain.device.ConnectChannel
import org.vetta.android.domain.device.DesktopDevice
import org.vetta.android.domain.device.DeviceStatus
import org.vetta.android.domain.error.UiError
import org.vetta.android.domain.error.UiErrorAction
import org.vetta.android.domain.session.LocalMessage
import org.vetta.android.domain.session.MessageImage
import org.vetta.android.domain.session.MessageStatus
import org.vetta.android.ui.chat.ChatScreen
import org.vetta.android.ui.connect.DeviceDetailScreen
import org.vetta.android.ui.connect.NewConversationScreen
import org.vetta.android.ui.i18n.Str
import org.vetta.android.ui.navigation.ChatSurface
import org.vetta.android.ui.theme.VettaTheme
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@RunWith(AndroidJUnit4::class)
class DesktopConversationScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun desktopDetailShowsConnectedStateAndStartsConversation() {
        var started = false
        var disconnected = false
        var backed = false
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
                    onBack = { backed = true },
                    onDisconnect = { disconnected = true },
                    onNewChat = { started = true },
                )
            }
        }

        composeRule.onNodeWithText("TEST-DESKTOP").assertIsDisplayed()
        composeRule.onNodeWithText(Str.deviceConnected).assertIsDisplayed()
        composeRule.onNodeWithText(Str.startConversation).performClick()
        assertTrue(started)
        composeRule.onNodeWithText(Str.disconnect).performClick()
        assertTrue(disconnected)
        composeRule.onNodeWithContentDescription(Str.back).performClick()
        assertTrue(backed)
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

    @Test
    fun desktopChatShowsAttributionOnceWithoutBottomDuplication() {
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                ChatScreen(
                    title = "TEST-DESKTOP",
                    surface = ChatSurface.Desktop,
                    messages = emptyList(),
                    draft = "",
                    pendingImages = emptyList(),
                    isStreaming = false,
                    models = emptyList(),
                    selectedModel = null,
                    modelPickerOpen = false,
                    globalError = null,
                    onDraftChange = {},
                    onSend = {},
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

        composeRule.onAllNodesWithText(Str.generatedByDesktop).assertCountEquals(1)
    }

    @Test
    fun streamingChatShowsStopAction() {
        var stopped = false
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                ChatScreen(
                    title = "TEST-DESKTOP",
                    surface = ChatSurface.Desktop,
                    messages = emptyList(),
                    draft = "",
                    pendingImages = emptyList(),
                    isStreaming = true,
                    models = emptyList(),
                    selectedModel = null,
                    modelPickerOpen = false,
                    globalError = null,
                    onDraftChange = {},
                    onSend = {},
                    onStop = { stopped = true },
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

        composeRule.onNodeWithContentDescription(Str.stop).performClick()
        assertTrue(stopped)
    }

    @Test
    fun pendingAttachmentCanBeRemoved() {
        var removedId: String? = null
        val image = MessageImage(id = "pending-1", mimeType = "image/png", base64Data = "")
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                ChatScreen(
                    title = "TEST-DESKTOP",
                    surface = ChatSurface.Desktop,
                    messages = listOf(
                        LocalMessage(
                            id = "message-1",
                            sessionId = "session-1",
                            role = ChatRole.User,
                            content = "hello",
                            status = MessageStatus.Complete,
                            createdAtEpochMs = 0L,
                        ),
                    ),
                    draft = "",
                    pendingImages = listOf(image),
                    isStreaming = false,
                    models = emptyList(),
                    selectedModel = null,
                    modelPickerOpen = false,
                    globalError = null,
                    onDraftChange = {},
                    onSend = {},
                    onStop = {},
                    onBack = {},
                    onOpenModelPicker = {},
                    onCloseModelPicker = {},
                    onSelectModel = {},
                    onErrorAction = {},
                    onDismissError = {},
                    onImagesPicked = {},
                    onRemovePendingImage = { removedId = it },
                )
            }
        }

        composeRule.onNodeWithContentDescription(Str.removeAttachment).performClick()
        assertEquals(image.id, removedId)
    }

    @Test
    fun partialChatFailureUsesCompactStatusInsteadOfRepeatingDetails() {
        val friendlyError = "连接已断开，请重试"
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                ChatScreen(
                    title = "TEST-DESKTOP",
                    surface = ChatSurface.Desktop,
                    messages = listOf(
                        LocalMessage(
                            id = "message-error",
                            sessionId = "session-1",
                            role = ChatRole.Assistant,
                            content = "已生成部分内容",
                            status = MessageStatus.Error,
                            errorMessage = friendlyError,
                            createdAtEpochMs = 0L,
                        ),
                    ),
                    draft = "",
                    pendingImages = emptyList(),
                    isStreaming = false,
                    models = emptyList(),
                    selectedModel = null,
                    modelPickerOpen = false,
                    globalError = null,
                    onDraftChange = {},
                    onSend = {},
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

        composeRule.onAllNodesWithText(friendlyError).assertCountEquals(0)
        composeRule.onNodeWithText(Str.responseInterrupted).assertIsDisplayed()
    }

    @Test
    fun emptyChatFailureShowsDetailsOnlyInRetryBanner() {
        val friendlyError = "请在电脑端检查模型配置和运行日志后重试"
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                ChatScreen(
                    title = "TEST-DESKTOP",
                    surface = ChatSurface.Desktop,
                    messages = listOf(
                        LocalMessage(
                            id = "message-error",
                            sessionId = "session-1",
                            role = ChatRole.Assistant,
                            content = "",
                            status = MessageStatus.Error,
                            errorMessage = friendlyError,
                            createdAtEpochMs = 0L,
                        ),
                    ),
                    draft = "",
                    pendingImages = emptyList(),
                    isStreaming = false,
                    models = emptyList(),
                    selectedModel = null,
                    modelPickerOpen = false,
                    globalError =
                        UiError(
                            title = "桌面执行失败",
                            message = friendlyError,
                            action = UiErrorAction.Retry,
                        ),
                    onDraftChange = {},
                    onSend = {},
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

        composeRule.onNodeWithText(Str.responseFailed).assertIsDisplayed()
        composeRule.onAllNodesWithText(friendlyError).assertCountEquals(1)
    }

    @Test
    fun newConversationKeepsHostDetailsOutOfUserFacingList() {
        var startedDevice: String? = null
        val device =
            DesktopDevice(
                id = "desktop-test",
                name = "TEST-DESKTOP",
                osLabel = "Windows",
                host = "10.0.2.2",
                status = DeviceStatus.Online,
            )
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                NewConversationScreen(
                    devices = listOf(device),
                    channelIndex = 0,
                    onChannelChange = {},
                    onBack = {},
                    onStartDesktop = { startedDevice = it },
                    onStartCloud = {},
                    onConnectDesktop = {},
                )
            }
        }

        assertEquals(0, composeRule.onAllNodesWithText(device.host).fetchSemanticsNodes().size)
        composeRule.onNodeWithText(Str.startConversation).performClick()
        assertTrue(startedDevice == device.id)
    }

    @Test
    fun newConversationWithoutOnlineDesktopOffersConnectionPath() {
        var connectRequested = false
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                NewConversationScreen(
                    devices = emptyList(),
                    channelIndex = 0,
                    onChannelChange = {},
                    onBack = {},
                    onStartDesktop = {},
                    onStartCloud = {},
                    onConnectDesktop = { connectRequested = true },
                )
            }
        }

        composeRule.onNodeWithText(Str.noAvailableDesktop).assertIsDisplayed()
        composeRule.onNodeWithText(Str.connectDesktop).performClick()
        assertTrue(connectRequested)
    }

    @Test
    fun cloudChatModelPickerSelectsModel() {
        val first = LlmModel("first", "first", "Model A", "Provider")
        val second = LlmModel("second", "second", "Model B", "Provider")
        var selected: LlmModel? = null
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                ChatScreen(
                    title = Str.channelCloud,
                    surface = ChatSurface.Cloud,
                    messages = emptyList(),
                    draft = "",
                    pendingImages = emptyList(),
                    isStreaming = false,
                    models = listOf(first, second),
                    selectedModel = first,
                    modelPickerOpen = true,
                    globalError = null,
                    onDraftChange = {},
                    onSend = {},
                    onStop = {},
                    onBack = {},
                    onOpenModelPicker = {},
                    onCloseModelPicker = {},
                    onSelectModel = { selected = it },
                    onErrorAction = {},
                    onDismissError = {},
                    onImagesPicked = {},
                    onRemovePendingImage = {},
                )
            }
        }

        composeRule.onNodeWithText(second.name).performClick()
        assertEquals(second, selected)
    }
}
