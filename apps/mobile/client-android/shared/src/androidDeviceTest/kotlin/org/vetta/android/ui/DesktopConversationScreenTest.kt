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
import org.vetta.android.core.model.ChatQuestion
import org.vetta.android.core.model.ChatQuestionOption
import org.vetta.android.domain.device.ConnectChannel
import org.vetta.android.domain.device.DesktopDevice
import org.vetta.android.domain.device.DeviceStatus
import org.vetta.android.domain.error.UiError
import org.vetta.android.domain.error.UiErrorAction
import org.vetta.android.ui.i18n.UiText
import org.vetta.android.domain.session.LocalMessage
import org.vetta.android.domain.session.MessageImage
import org.vetta.android.domain.session.MessageStatus
import org.vetta.android.domain.session.PendingQuestion
import org.vetta.android.domain.session.ToolTrace
import org.vetta.android.ui.chat.ChatScreen
import org.vetta.android.ui.connect.DeviceDetailScreen
import org.vetta.android.ui.connect.NewConversationScreen
import org.vetta.android.resources.Res
import org.vetta.android.resources.pending_desktop_question_title
import org.vetta.android.resources.submit_answer
import org.vetta.android.resources.tool_completed
import org.vetta.android.resources.tool_read_file
import org.vetta.android.resources.back
import org.vetta.android.resources.channel_cloud
import org.vetta.android.resources.connect_desktop
import org.vetta.android.resources.copied
import org.vetta.android.resources.copy
import org.vetta.android.resources.device_connected
import org.vetta.android.resources.disconnect
import org.vetta.android.resources.generated_by_desktop
import org.vetta.android.resources.no_available_desktop
import org.vetta.android.resources.remove_attachment
import org.vetta.android.resources.response_failed
import org.vetta.android.resources.response_interrupted
import org.vetta.android.resources.send
import org.vetta.android.resources.show_tool_details
import org.vetta.android.resources.start_conversation
import org.vetta.android.resources.stop
import org.vetta.android.resources.thinking
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
    fun desktopChatRendersMarkdownToolsAndPendingQuestion() {
        var submitted = false
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                ChatScreen(
                    title = "TEST-DESKTOP",
                    surface = ChatSurface.Desktop,
                    messages = listOf(
                        LocalMessage(
                            id = "assistant-1",
                            sessionId = "session-1",
                            role = ChatRole.Assistant,
                            content =
                                """
                                ## 结果

                                ```kotlin
                                val answer = 42
                                ```

                                | 字段 | 值 |
                                | --- | --- |
                                | 状态 | 完成 |

                                [查看文档](https://example.com)
                                """.trimIndent(),
                            status = MessageStatus.Complete,
                            createdAtEpochMs = 1,
                            toolEvents = listOf(
                                ToolTrace(
                                    phase = "completed",
                                    toolCallId = "call-1",
                                    toolName = "read_file",
                                    arguments = "{\"path\":\"README.md\"}",
                                    phaseLabel = "读取文件内容",
                                ),
                            ),
                        ),
                    ),
                    draft = "",
                    pendingImages = emptyList(),
                    isStreaming = true,
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
                    pendingQuestion = PendingQuestion(
                        requestId = "request-1",
                        questions = listOf(ChatQuestion("继续执行吗？", "确认", listOf(ChatQuestionOption("继续")))),
                        selections = mapOf("继续执行吗？" to listOf("继续")),
                    ),
                    onToggleQuestionOption = { _, _ -> },
                    onSubmitQuestion = { submitted = true },
                )
            }
        }

        composeRule.onNodeWithText("val answer = 42").assertIsDisplayed()
        composeRule.waitUntil(5_000) {
            composeRule.onAllNodesWithText("状态", substring = true).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText("状态", substring = true).assertExists()
        composeRule.onNodeWithText("查看文档").assertExists()
        composeRule.onNodeWithContentDescription(str(Res.string.copy)).performClick()
        composeRule.onNodeWithContentDescription(str(Res.string.copied)).assertIsDisplayed()
        composeRule.onNodeWithText("${str(Res.string.tool_read_file)} · README.md · ${str(Res.string.tool_completed)} · 读取文件内容").assertIsDisplayed()
        composeRule.onNodeWithContentDescription(str(Res.string.show_tool_details)).performClick()
        composeRule.onNodeWithText("{\"path\":\"README.md\"}").assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.pending_desktop_question_title)).assertIsDisplayed()
        composeRule.onNodeWithText("继续执行吗？").assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.submit_answer)).assertIsDisplayed().assertIsEnabled()
        composeRule.onNodeWithText(str(Res.string.submit_answer)).performClick()
        assertTrue(submitted)
    }

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
        composeRule.onNodeWithText(str(Res.string.device_connected)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.start_conversation)).performClick()
        assertTrue(started)
        composeRule.onNodeWithText(str(Res.string.disconnect)).performClick()
        assertTrue(disconnected)
        composeRule.onNodeWithContentDescription(str(Res.string.back)).performClick()
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

        composeRule.onNodeWithContentDescription(str(Res.string.send)).assertIsEnabled().performClick()
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

        composeRule.onAllNodesWithText(str(Res.string.generated_by_desktop)).assertCountEquals(1)
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

        composeRule.onNodeWithContentDescription(str(Res.string.stop)).performClick()
        assertTrue(stopped)
    }

    @Test
    fun streamingChatShowsHumanReadableRuntimeStatus() {
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                ChatScreen(
                    title = "TEST-DESKTOP",
                    surface = ChatSurface.Desktop,
                    messages = emptyList(),
                    draft = "",
                    pendingImages = emptyList(),
                    isStreaming = true,
                    streamingStatus = "thinking",
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

        composeRule.onNodeWithText(str(Res.string.thinking)).assertIsDisplayed()
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

        composeRule.onNodeWithContentDescription(str(Res.string.remove_attachment)).performClick()
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
        composeRule.onNodeWithText(str(Res.string.response_interrupted)).assertIsDisplayed()
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
                            title = UiText.Raw("Desktop run failed"),
                            message = UiText.Raw(friendlyError),
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

        composeRule.onNodeWithText(str(Res.string.response_failed)).assertIsDisplayed()
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
        composeRule.onNodeWithText(str(Res.string.start_conversation)).performClick()
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

        composeRule.onNodeWithText(str(Res.string.no_available_desktop)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.connect_desktop)).performClick()
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
                    title = str(Res.string.channel_cloud),
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
