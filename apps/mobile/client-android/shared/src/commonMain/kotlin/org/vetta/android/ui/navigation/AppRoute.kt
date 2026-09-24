package org.vetta.android.ui.navigation

import org.vetta.android.domain.device.ConnectChannel

enum class MainTab {
    Home,
    /** The paired desktop's sessions. */
    Work,
    Sessions,
    Discover,
    Me,
}

enum class ChatSurface {
    /** 对接 Desktop 会话 */
    Desktop,
    /** 云端 AI */
    Cloud,
}

sealed class AppRoute {
    data object Boot : AppRoute()

    data object Welcome : AppRoute()

    data object Login : AppRoute()

    /** 带底部导航的主壳 */
    data class Main(val tab: MainTab = MainTab.Home) : AppRoute()

    data class DeviceDetail(val deviceId: String) : AppRoute()

    data class NewConversation(
        val channel: ConnectChannel = ConnectChannel.Lan,
    ) : AppRoute()

    data class Chat(
        val sessionId: String?,
        val surface: ChatSurface = ChatSurface.Cloud,
        val title: String = "",
        val deviceId: String? = null,
    ) : AppRoute()

    /** One desktop session; `sessionId` may be the local id of one New Session is starting. */
    data class WorkSession(val sessionId: String) : AppRoute()

    data object Plan : AppRoute()

    data object Settings : AppRoute()

    data object About : AppRoute()
}
