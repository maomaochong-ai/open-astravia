package org.vetta.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.vetta.android.app.AndroidAppContainer
import org.vetta.android.app.SessionNotifier
import org.vetta.android.domain.work.IncomingShare
import org.vetta.android.ui.work.isShareIntent
import org.vetta.android.ui.work.readShare

class MainActivity : ComponentActivity() {
    private var pendingPairingInvite by mutableStateOf<String?>(null)
    private var pendingShare by mutableStateOf<IncomingShare?>(null)
    private var pendingSession by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        pendingPairingInvite = pairingInviteFrom(intent)
        // A share is read once; a recreated activity must not add it to the draft again.
        if (savedInstanceState == null) takeShare(intent)
        pendingSession = intent.getStringExtra(SessionNotifier.EXTRA_SESSION_ID)

        val container = AndroidAppContainer.get(this)
        setContent {
            App(
                container = container,
                pairingInvite = pendingPairingInvite,
                onPairingInviteHandled = ::clearHandledPairingInvite,
                incomingShare = pendingShare,
                onShareHandled = { pendingShare = null },
                openSession = pendingSession,
                onOpenSessionHandled = {
                    pendingSession = null
                    intent.removeExtra(SessionNotifier.EXTRA_SESSION_ID)
                },
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingPairingInvite = pairingInviteFrom(intent)
        takeShare(intent)
        intent.getStringExtra(SessionNotifier.EXTRA_SESSION_ID)?.let { pendingSession = it }
    }

    /** Reads what another app shared, off the main thread, and hands it to the app once. */
    private fun takeShare(intent: Intent) {
        if (!isShareIntent(intent)) return
        lifecycleScope.launch {
            val share = readShare(this@MainActivity, intent)
            if (share != null && !share.isEmpty) pendingShare = share
        }
    }

    private fun clearHandledPairingInvite() {
        pendingPairingInvite = null
        if (pairingInviteFrom(intent) != null) {
            setIntent(Intent(intent).setData(null))
        }
    }
}

internal fun pairingInviteFrom(intent: Intent): String? {
    val data = intent.data ?: return null
    return data.toString().takeIf { data.scheme == "vetta" && data.host == "pair" }
}

@Preview
@Composable
fun AppAndroidPreview() {
    App()
}
