package org.vetta.android.ui.remote

import android.Manifest
import android.content.pm.PackageManager
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.mlkit.vision.MlKitAnalyzer
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import org.vetta.android.domain.remote.connection.PlatformRemoteLogger
import org.vetta.android.ui.components.SecondaryOutlineButton
import org.vetta.android.ui.i18n.Str

@Composable
actual fun PairingScannerButton(
    onScanned: (String) -> Unit,
    modifier: Modifier,
    label: String?,
) {
    val context = LocalContext.current
    var scanning by remember { mutableStateOf(false) }
    val permissionLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) {
                scanning = true
            } else {
                Toast.makeText(context, Str.cameraPermissionRequired, Toast.LENGTH_SHORT).show()
                PlatformRemoteLogger.warn("pairing camera permission denied")
            }
        }

    val openScanner = {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            scanning = true
        } else {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }
    if (label == null) {
        IconButton(modifier = modifier, onClick = openScanner) {
            Icon(Icons.Default.QrCodeScanner, contentDescription = Str.scanPairingQr)
        }
    } else {
        SecondaryOutlineButton(
            modifier = modifier.height(48.dp),
            onClick = openScanner,
            text = label,
            leadingIcon = {
                Icon(Icons.Default.QrCodeScanner, contentDescription = null)
            },
        )
    }

    if (scanning) {
        PairingScannerDialog(
            onDismiss = { scanning = false },
            onScanned = { value ->
                scanning = false
                onScanned(value)
            },
        )
    }
}

@Composable
private fun PairingScannerDialog(onDismiss: () -> Unit, onScanned: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val executor = remember(context) { ContextCompat.getMainExecutor(context) }
    val scanner = rememberBarcodeScanner()
    val controller = remember(context) {
        LifecycleCameraController(context).apply { cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA }
    }
    var delivered by remember { mutableStateOf(false) }

    DisposableEffect(controller, lifecycleOwner, scanner) {
        val analyzer =
            MlKitAnalyzer(
                listOf(scanner),
                ImageAnalysis.COORDINATE_SYSTEM_VIEW_REFERENCED,
                executor,
            ) { result ->
                val value = result?.getValue(scanner)?.firstOrNull()?.rawValue
                if (!delivered && !value.isNullOrBlank()) {
                    delivered = true
                    onScanned(value)
                }
            }
        runCatching {
            controller.setImageAnalysisAnalyzer(executor, analyzer)
            controller.bindToLifecycle(lifecycleOwner)
        }.onFailure { error ->
            Toast.makeText(context, Str.cameraUnavailable, Toast.LENGTH_SHORT).show()
            PlatformRemoteLogger.warn(
                "pairing camera initialization failed",
                mapOf("error" to (error.message ?: error::class.simpleName)),
            )
            onDismiss()
        }
        onDispose {
            controller.clearImageAnalysisAnalyzer()
            controller.unbind()
            scanner.close()
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { viewContext ->
                    PreviewView(viewContext).apply {
                        implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                        scaleType = PreviewView.ScaleType.FILL_CENTER
                        this.controller = controller
                    }
                },
            )
            Column(
                modifier = Modifier.align(Alignment.Center),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                Box(
                    Modifier
                        .size(252.dp)
                        .border(2.dp, Color.White.copy(alpha = 0.9f), RoundedCornerShape(8.dp)),
                )
                Text(Str.alignPairingQr, color = Color.White, style = MaterialTheme.typography.bodyMedium)
            }
            IconButton(
                modifier = Modifier.align(Alignment.TopEnd).padding(top = 42.dp, end = 16.dp),
                onClick = onDismiss,
            ) {
                Icon(Icons.Default.Close, contentDescription = Str.closeScanner, tint = Color.White)
            }
        }
    }
}

@Composable
private fun rememberBarcodeScanner(): BarcodeScanner =
    remember {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build(),
        )
    }
