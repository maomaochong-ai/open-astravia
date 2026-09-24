package org.vetta.android.domain.conversation

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.russhwolf.settings.MapSettings
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.vetta.android.core.model.ChatMessage
import org.vetta.android.core.model.ChatRole
import org.vetta.android.core.model.ChatStreamEvent
import org.vetta.android.data.remote.MemorySessionCache
import org.vetta.android.domain.device.DeviceStatus
import org.vetta.android.domain.remote.connection.KtorWebSocketRemoteTransport
import org.vetta.android.domain.remote.parsePairingInvite
import org.vetta.android.domain.session.nowEpochMs
import org.vetta.android.domain.work.DesktopMirror
import org.vetta.android.domain.work.MirrorPlatform
import kotlin.test.assertContains
import kotlin.test.assertNotNull

private const val LIVE_INVITE_FILE_ARGUMENT = "vettaLiveInviteFile"
private const val EXPECTED_REPLY_MARKER = "VETTA_REMOTE_E2E_OK"

/**
 * Opt-in production-path acceptance test. It requires a live Desktop pairing invite and may call a paid model.
 * Normal device-test runs skip it because they do not provide [LIVE_INVITE_FILE_ARGUMENT].
 */
@RunWith(AndroidJUnit4::class)
class RemoteLiveConversationE2ETest {
    @Test
    fun emulatorPairsWithDesktopAndReceivesRealModelReply() =
        runBlocking {
            val invitePath =
                InstrumentationRegistry.getArguments().getString(LIVE_INVITE_FILE_ARGUMENT).orEmpty()
            assumeTrue("Live pairing invite was not provided", invitePath.isNotBlank())

            val invite = File(invitePath).readText().trim()
            assertNotNull(parsePairingInvite(invite))
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
            val mirror =
                DesktopMirror(
                    MirrorPlatform(
                        settings = MapSettings(),
                        secrets = MapSettings(),
                        cache = MemorySessionCache(),
                        createTransport = { url, secret -> KtorWebSocketRemoteTransport(url, secret, scope) },
                        deviceName = "Android live E2E",
                        now = ::nowEpochMs,
                    ),
                    scope,
                )
            withContext(Dispatchers.Main) { mirror.start() }
            val gateway = MirrorConversationGateway(mirror, scope)
            try {
                withTimeout(30_000) {
                    check(withContext(Dispatchers.Main) { gateway.connect(invite) }) { "pairing failed" }
                    gateway.devices.first { it.singleOrNull()?.status == DeviceStatus.Online }
                }
                val events =
                    withTimeout(180_000) {
                        withContext(Dispatchers.Main) {
                            gateway
                                .stream(
                                    localSessionId = "android-live-e2e",
                                    deviceId = gateway.devices.value.single().id,
                                    remoteSessionId = null,
                                    messages =
                                        listOf(
                                            ChatMessage(
                                                ChatRole.User,
                                                "这是一次远程链路验收。不要调用任何工具，仅回复：$EXPECTED_REPLY_MARKER",
                                            ),
                                        ),
                                ).toList()
                        }
                    }
                val answer = events.filterIsInstance<ChatStreamEvent.Delta>().joinToString("") { it.text }
                assertContains(answer, EXPECTED_REPLY_MARKER)
            } finally {
                withContext(Dispatchers.Main) { gateway.disconnect(gateway.devices.value.firstOrNull()?.id.orEmpty()) }
                scope.cancel()
            }
        }
}
