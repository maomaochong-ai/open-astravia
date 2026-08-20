package org.vetta.android.ui.remote

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import org.vetta.android.domain.remote.connection.PlatformRemoteLogger
import org.vetta.android.ui.i18n.Str

@Composable
actual fun PairingScannerButton(onScanned: (String) -> Unit, modifier: Modifier) {
    val context = LocalContext.current
    val activity = context.findActivity()
    val scanner = remember(activity) {
        activity?.let {
            GmsBarcodeScanning.getClient(
                it,
                GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).enableAutoZoom().build(),
            )
        }
    }
    IconButton(
        modifier = modifier,
        enabled = scanner != null,
        onClick = {
            scanner?.startScan()
                ?.addOnSuccessListener { barcode -> barcode.rawValue?.let(onScanned) }
                ?.addOnFailureListener { error ->
                    PlatformRemoteLogger.warn("pairing QR scan failed", mapOf("error" to (error.message ?: error::class.simpleName)))
                }
        },
    ) {
        Icon(Icons.Default.QrCodeScanner, contentDescription = Str.scanPairingQr)
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
