package org.vetta.android.ui.remote

import android.Manifest
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Outline
import android.net.Uri
import android.provider.Settings
import android.view.View
import android.view.ViewOutlineProvider
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.mlkit.vision.MlKitAnalyzer
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.connection.PlatformRemoteLogger
import org.vetta.android.resources.Res
import org.vetta.android.resources.camera_permission_required
import org.vetta.android.resources.camera_unavailable
import org.vetta.android.resources.pair_grant_camera
import org.vetta.android.ui.design.GlassCapsuleButton
import org.vetta.android.ui.work.workColors

@Composable
actual fun PairingCameraPreview(
    active: Boolean,
    onScanned: (String) -> Unit,
    onLive: (Boolean) -> Unit,
    modifier: Modifier,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val hasCamera = remember(context) {
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
    }
    var granted by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED,
        )
    }
    // `requestStarted` blocks a second automatic prompt; `requestDone` stays false
    // until the system dialog answers, so the frame does not flash "denied" over it.
    var requestStarted by remember { mutableStateOf(false) }
    var requestDone by remember { mutableStateOf(granted) }
    var failed by remember { mutableStateOf(false) }
    val permissionLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
            granted = allowed
            requestDone = true
            if (!allowed) PlatformRemoteLogger.warn("pairing camera permission denied")
        }

    DisposableEffect(lifecycleOwner, context) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                val allowed =
                    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                granted = allowed
                if (allowed) requestDone = true
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    LaunchedEffect(active, hasCamera) {
        if (!active) {
            failed = false
            return@LaunchedEffect
        }
        if (!hasCamera || granted || requestStarted) return@LaunchedEffect
        requestStarted = true
        runCatching { permissionLauncher.launch(Manifest.permission.CAMERA) }
            .onFailure { error ->
                requestDone = true
                PlatformRemoteLogger.warn(
                    "pairing camera permission request failed",
                    mapOf("error" to (error.message ?: error::class.simpleName)),
                )
            }
    }

    val live = active && hasCamera && granted && !failed
    val reportLive by rememberUpdatedState(onLive)
    SideEffect { reportLive(live) }

    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        when {
            !active && granted && hasCamera -> Box(Modifier.fillMaxSize().background(Color.Black))
            !active -> Unit
            !hasCamera || failed ->
                CameraMessage(stringResource(Res.string.camera_unavailable), Modifier.testTag("pair.camera.unavailable"))
            granted -> LivePreview(onScanned = onScanned, onFailed = { failed = true })
            requestDone ->
                CameraAccessPrompt(
                    onAllow = {
                        val activity = context.findActivity()
                        val blocked = activity != null &&
                            !ActivityCompat.shouldShowRequestPermissionRationale(activity, Manifest.permission.CAMERA)
                        if (blocked) {
                            openAppSettings(context)
                        } else {
                            runCatching { permissionLauncher.launch(Manifest.permission.CAMERA) }
                                .onFailure { error ->
                                    PlatformRemoteLogger.warn(
                                        "pairing camera permission request failed",
                                        mapOf("error" to (error.message ?: error::class.simpleName)),
                                    )
                                }
                        }
                    },
                )
            else ->
                CircularProgressIndicator(
                    Modifier.size(28.dp).testTag("pair.camera.requesting"),
                    color = MaterialTheme.workColors.green,
                    strokeWidth = 2.dp,
                )
        }
    }
}

/** Back camera filling the frame. Stops when it leaves the composition. */
@Composable
private fun LivePreview(onScanned: (String) -> Unit, onFailed: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val executor = remember(context) { ContextCompat.getMainExecutor(context) }
    val scanner = rememberBarcodeScanner()
    val controller = remember(context) {
        LifecycleCameraController(context).apply { cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA }
    }
    val currentOnScanned by rememberUpdatedState(onScanned)
    val currentOnFailed by rememberUpdatedState(onFailed)

    DisposableEffect(controller, lifecycleOwner, scanner) {
        var disposed = false
        var delivered = false
        val analyzer =
            MlKitAnalyzer(
                listOf(scanner),
                ImageAnalysis.COORDINATE_SYSTEM_VIEW_REFERENCED,
                executor,
            ) { result ->
                val value = result?.getValue(scanner)?.firstOrNull()?.rawValue
                if (!disposed && !delivered && !value.isNullOrBlank()) {
                    delivered = true
                    currentOnScanned(value)
                }
            }
        val started =
            runCatching {
                controller.setImageAnalysisAnalyzer(executor, analyzer)
                controller.bindToLifecycle(lifecycleOwner)
            }
        if (started.isFailure) {
            val error = started.exceptionOrNull()
            PlatformRemoteLogger.warn(
                "pairing camera initialization failed",
                mapOf("error" to (error?.message ?: error?.let { it::class.simpleName })),
            )
            currentOnFailed()
        } else {
            controller.initializationFuture.addListener({
                if (disposed) return@addListener
                val error = runCatching { controller.initializationFuture.get() }.exceptionOrNull()
                if (!disposed && error != null) {
                    PlatformRemoteLogger.warn(
                        "pairing camera initialization failed",
                        mapOf("error" to (error.message ?: error::class.simpleName)),
                    )
                    currentOnFailed()
                }
            }, executor)
        }
        onDispose {
            disposed = true
            controller.clearImageAnalysisAnalyzer()
            controller.unbind()
            scanner.close()
        }
    }

    Box(modifier.fillMaxSize().background(Color.Black).testTag("pair.camera.preview")) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { viewContext ->
                PreviewView(viewContext).apply {
                    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                    scaleType = PreviewView.ScaleType.FILL_CENTER
                    clipToOutline = true
                    outlineProvider =
                        object : ViewOutlineProvider() {
                            override fun getOutline(view: View, outline: Outline) {
                                val radius = 36f * view.resources.displayMetrics.density
                                outline.setRoundRect(0, 0, view.width, view.height, radius)
                            }
                        }
                    this.controller = controller
                }
            },
            update = { view -> view.controller = controller },
        )
    }
}

@Composable
private fun CameraAccessPrompt(onAllow: () -> Unit) {
    Column(
        Modifier.padding(horizontal = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            stringResource(Res.string.camera_permission_required),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        GlassCapsuleButton(
            text = stringResource(Res.string.pair_grant_camera),
            onClick = onAllow,
            height = 40.dp,
            tag = "pair.camera.grant",
        )
    }
}

@Composable
private fun CameraMessage(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier.padding(horizontal = 16.dp),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
    )
}

@Composable
private fun rememberBarcodeScanner(): BarcodeScanner =
    remember {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build(),
        )
    }

private fun Context.findActivity(): ComponentActivity? {
    var current: Context = this
    while (current is ContextWrapper) {
        if (current is ComponentActivity) return current
        val next = current.baseContext
        if (next == current) return null
        current = next
    }
    return null
}

private fun openAppSettings(context: Context) {
    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
    val activity = context.findActivity()
    if (activity != null) activity.startActivity(intent) else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}
