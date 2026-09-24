package org.vetta.android.ui.work

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ContentResolver
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.vetta.android.domain.remote.AttachmentKind
import org.vetta.android.domain.work.PromptAttachment
import org.vetta.android.domain.work.PromptDraft
import kotlin.math.max
import kotlin.math.roundToInt

@Composable
actual fun rememberAttachmentLaunchers(onPick: (AttachmentPick) -> Unit): AttachmentLaunchers {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val deliver by rememberUpdatedState(onPick)
    // Survives the process being recreated while the camera app is in front.
    var shot by rememberSaveable { mutableStateOf<String?>(null) }

    fun read(uris: List<Uri>) {
        if (uris.isEmpty()) return
        scope.launch {
            val results = withContext(Dispatchers.IO) { uris.map { AttachmentReader.read(context, it) } }
            results.filterIsInstance<AttachmentPick.TooLarge>().forEach(deliver)
            val picked = results.filterIsInstance<AttachmentPick.Picked>().flatMap { it.attachments }
            if (picked.isNotEmpty()) deliver(AttachmentPick.Picked(picked))
        }
    }

    val photos =
        rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(PromptDraft.MAX_ATTACHMENTS)) { read(it) }
    val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { read(it) }
    val camera =
        rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
            val path = shot ?: return@rememberLauncherForActivityResult
            shot = null
            val file = File(path)
            if (!saved) {
                file.delete()
                return@rememberLauncherForActivityResult
            }
            scope.launch {
                val result = withContext(Dispatchers.IO) { AttachmentReader.readShot(file) }
                file.delete()
                deliver(result)
            }
        }

    fun launchCamera() {
        val file = AttachmentReader.newShotFile(context)
        val uri = FileProvider.getUriForFile(context, AttachmentReader.authority(context), file)
        shot = file.path
        try {
            camera.launch(uri)
        } catch (_: ActivityNotFoundException) {
            shot = null
            file.delete()
            deliver(AttachmentPick.CameraUnavailable)
        }
    }

    // The app holds CAMERA for scanning pairing codes, so the system camera needs it granted too.
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) launchCamera() else deliver(AttachmentPick.CameraDenied)
        }

    return remember(photos, files, camera, permission) {
        AttachmentLaunchers(
            photos = { photos.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            camera = {
                when {
                    !context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) -> deliver(AttachmentPick.CameraUnavailable)
                    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED -> launchCamera()
                    else -> permission.launch(Manifest.permission.CAMERA)
                }
            },
            files = { files.launch(arrayOf("*/*")) },
        )
    }
}

/** Turns what a picker returned into attachments one `session.upload` can carry. */
internal object AttachmentReader {
    fun authority(context: Context): String = "${context.packageName}.attachments"

    fun newShotFile(context: Context): File =
        File(context.cacheDir, "camera").apply { mkdirs() }.let { File.createTempFile("shot-", ".jpg", it) }

    fun read(context: Context, uri: Uri): AttachmentPick {
        val resolver = context.contentResolver
        val name = displayName(resolver, uri) ?: uri.lastPathSegment ?: "attachment"
        val mimeType = resolver.getType(uri) ?: "application/octet-stream"
        if (mimeType.startsWith("image/")) {
            val bytes = decode(resolver, uri)?.let { ImageDownscaler.jpeg(it, PromptDraft.MAX_ATTACHMENT_BYTES) } ?: return AttachmentPick.TooLarge(name)
            return AttachmentPick.Picked(listOf(PromptAttachment(AttachmentKind.Image, jpegName(name), "image/jpeg", bytes)))
        }
        // Refuse before reading a file that cannot fit, so a large one is never loaded whole.
        val size = querySize(resolver, uri)
        if (size != null && size > PromptDraft.MAX_ATTACHMENT_BYTES) return AttachmentPick.TooLarge(name)
        val bytes = resolver.openInputStream(uri)?.use { it.readAtMost(PromptDraft.MAX_ATTACHMENT_BYTES + 1) } ?: return AttachmentPick.TooLarge(name)
        if (bytes.isEmpty() || bytes.size > PromptDraft.MAX_ATTACHMENT_BYTES) return AttachmentPick.TooLarge(name)
        return AttachmentPick.Picked(listOf(PromptAttachment(AttachmentKind.File, name, mimeType, bytes)))
    }

    fun readShot(file: File): AttachmentPick {
        val name = "photo-${file.nameWithoutExtension.removePrefix("shot-")}.jpg"
        val bitmap = decode(file) ?: return AttachmentPick.TooLarge(name)
        val bytes = ImageDownscaler.jpeg(bitmap, PromptDraft.MAX_ATTACHMENT_BYTES) ?: return AttachmentPick.TooLarge(name)
        return AttachmentPick.Picked(listOf(PromptAttachment(AttachmentKind.Image, name, "image/jpeg", bytes)))
    }

    /** Reads until `limit` bytes are in or the stream ends, whichever comes first. */
    private fun InputStream.readAtMost(limit: Int): ByteArray {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        while (out.size() < limit) {
            val read = read(buffer, 0, minOf(buffer.size, limit - out.size()))
            if (read < 0) break
            out.write(buffer, 0, read)
        }
        return out.toByteArray()
    }

    private fun jpegName(name: String): String = name.substringBeforeLast('.', name) + ".jpg"

    private fun displayName(resolver: ContentResolver, uri: Uri): String? =
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }

    private fun querySize(resolver: ContentResolver, uri: Uri): Long? =
        resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0) else null
        }

    /** Decoded upright (camera pictures carry their rotation in EXIF) and no larger than it needs to be. */
    private fun decode(resolver: ContentResolver, uri: Uri): Bitmap? =
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri), ::limitSize)
            } else {
                resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 }) }
            }
        }.getOrNull()

    private fun decode(file: File): Bitmap? =
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                ImageDecoder.decodeBitmap(ImageDecoder.createSource(file), ::limitSize)
            } else {
                BitmapFactory.decodeFile(file.path)
            }
        }.getOrNull()

    private fun limitSize(decoder: ImageDecoder, info: ImageDecoder.ImageInfo, source: ImageDecoder.Source) {
        val longest = max(info.size.width, info.size.height)
        if (longest > ImageDownscaler.START_LONGEST) {
            val scale = ImageDownscaler.START_LONGEST.toFloat() / longest
            decoder.setTargetSize((info.size.width * scale).roundToInt(), (info.size.height * scale).roundToInt())
        }
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
    }
}

/** Re-encodes a picture as JPEG, shrinking it until it fits `maxBytes` (as the iPhone app does). */
object ImageDownscaler {
    const val START_LONGEST = 2048

    fun jpeg(source: Bitmap, maxBytes: Int): ByteArray? {
        var longest = START_LONGEST.toFloat()
        repeat(6) {
            val image = resized(source, longest)
            for (quality in intArrayOf(80, 60, 45)) {
                val encoded = ByteArrayOutputStream().use { out -> image.compress(Bitmap.CompressFormat.JPEG, quality, out); out.toByteArray() }
                if (encoded.size <= maxBytes) return encoded
            }
            longest *= 0.7f
        }
        return null
    }

    private fun resized(image: Bitmap, longest: Float): Bitmap {
        val scale = minOf(1f, longest / max(image.width, image.height))
        if (scale >= 1f) return image
        return Bitmap.createScaledBitmap(image, (image.width * scale).roundToInt().coerceAtLeast(1), (image.height * scale).roundToInt().coerceAtLeast(1), true)
    }
}
