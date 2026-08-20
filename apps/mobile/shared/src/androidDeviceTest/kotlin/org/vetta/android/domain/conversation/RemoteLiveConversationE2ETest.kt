package org.vetta.android.domain.conversation

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.vetta.android.core.model.ChatMessage
import org.vetta.android.core.model.ChatRole
import org.vetta.android.core.model.ChatStreamEvent
import org.vetta.android.domain.remote.buildMobileBootstrapTarget
import org.vetta.android.domain.remote.buildMobileResumeTarget
import org.vetta.android.domain.remote.parsePairingInvite
import kotlin.test.assertContains
import kotlin.test.assertNotNull

private const val LIVE_INVITE_FILE_ARGUMENT = "vettaLiveInviteFile"
private const val LIVE_CONNECTION_MODE_ARGUMENT = "vettaLiveConnectionMode"
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

            val invite = assertNotNull(parsePairingInvite(File(invitePath).readText().trim()))
            val resumeSecret = "android-live-e2e-resume-secret-0000000000000000"
            check(resumeSecret.length >= 32) {
                "The live-test resume secret must satisfy the relay credential contract"
            }
            val gateway = RelayRemoteConversationGateway()
            try {
                withTimeout(30_000) {
                    val target =
                        when (InstrumentationRegistry.getArguments().getString(LIVE_CONNECTION_MODE_ARGUMENT)) {
                            "resume" -> buildMobileResumeTarget(invite, resumeSecret)
                            else -> buildMobileBootstrapTarget(invite, resumeSecret)
                        }
                    gateway.connect(target)
                }
                val events =
                    withTimeout(180_000) {
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
                val answer = events.filterIsInstance<ChatStreamEvent.Delta>().joinToString("") { it.text }
                assertContains(answer, EXPECTED_REPLY_MARKER)
            } finally {
                gateway.disconnect(gateway.devices.value.firstOrNull()?.id.orEmpty())
            }
        }
}
