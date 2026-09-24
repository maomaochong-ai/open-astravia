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
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.vetta.android.domain.remote.pairing.SettingsSecretStore
import org.vetta.android.data.remote.MemorySessionCache
import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.TranscriptItem
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
            // The mirror is confined to one thread, as in the app.
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
            val mirror =
                DesktopMirror(
                    MirrorPlatform(
                        settings = MapSettings(),
                        secrets = SettingsSecretStore(MapSettings()),
                        cache = MemorySessionCache(),
                        createTransport = { url, secret -> KtorWebSocketRemoteTransport(url, secret, scope) },
                        deviceName = "Android live E2E",
                        now = ::nowEpochMs,
                    ),
                    scope,
                )
            try {
                withContext(Dispatchers.Main) {
                    mirror.start()
                    check(mirror.pairWithCode(invite)) { "pairing failed" }
                    withTimeout(30_000) { mirror.state.first { it.online } }
                    val sessionId =
                        checkNotNull(mirror.sendPrompt(null, "这是一次远程链路验收。不要调用任何工具，仅回复：$EXPECTED_REPLY_MARKER")) {
                            "the prompt did not go out"
                        }
                    val finished =
                        withTimeout(180_000) {
                            mirror.state.first {
                                val status = it.transcript(sessionId).sessionState.status
                                status == RemoteSessionStatus.Completed || status == RemoteSessionStatus.Error
                            }
                        }
                    val answer =
                        finished
                            .transcript(sessionId)
                            .items
                            .filterIsInstance<TranscriptItem.Assistant>()
                            .joinToString("") { it.turn.text }
                    assertContains(answer, EXPECTED_REPLY_MARKER)
                }
            } finally {
                withContext(Dispatchers.Main) { mirror.unpair() }
                scope.cancel()
            }
        }
}
