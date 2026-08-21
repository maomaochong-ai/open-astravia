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

class MainActivity : ComponentActivity() {
    private var pendingPairingInvite by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        pendingPairingInvite = pairingInviteFrom(intent)

        setContent {
            App(
                pairingInvite = pendingPairingInvite,
                onPairingInviteHandled = ::clearHandledPairingInvite,
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingPairingInvite = pairingInviteFrom(intent)
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
