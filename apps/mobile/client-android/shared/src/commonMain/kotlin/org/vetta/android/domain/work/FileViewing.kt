package org.vetta.android.domain.work

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.vetta.android.domain.remote.RemoteApi
import org.vetta.android.domain.remote.RemoteFileInfo
import org.vetta.android.domain.remote.connection.RemoteRequestException
import org.vetta.android.domain.remote.link.LinkChannel
import org.vetta.android.domain.remote.link.LinkOfflineException
import org.vetta.android.domain.remote.protocol.RemoteErrorCode
import org.vetta.android.domain.work.documents.DocumentPreview

/*
 * Viewing the desktop's files from the phone (port of the iPhone's `FileViewing`,
 * ADR-0139): which reply links point at them, how a file is fetched in chunks and how
 * it is shown.
 */

/** What tapping a link in a reply does. */
sealed interface ReplyLink {
    /** A web page or a system scheme (`mailto:`, `tel:`…); the system opens it. */
    data object System : ReplyLink

    /** A file on the desktop; the text is the link as written, which the desktop resolves. */
    data class DesktopFile(val href: String) : ReplyLink

    companion object {
        private val SCHEME = Regex("^([A-Za-z][A-Za-z0-9+.-]*):")

        /**
         * Web addresses and anything with its own scheme go to the system; everything else
         * (relative and absolute paths, `file://`, `~/…`, Windows drives) is a desktop file,
         * left to the desktop to resolve rather than guessed at here.
         */
        fun classify(href: String): ReplyLink {
            if (href.isEmpty() || href.startsWith("#")) return System
            val scheme = SCHEME.find(href)?.groupValues?.get(1)?.lowercase() ?: return DesktopFile(href)
            // `C:/x` reads as a one-letter scheme: a Windows drive.
            return if (scheme == "file" || scheme.length == 1) DesktopFile(href) else System
        }
    }
}

/** How the phone shows a file. */
enum class FilePreviewKind {
    Markdown,
    Html,

    /** Code and other text, shown as it is. */
    Text,
    /** A picture the phone decodes itself. */
    Image,

    /** A picture drawn by the web view: animated GIFs and SVG. */
    WebImage,
    Pdf,

    /** Sound, played with the system's player. */
    Audio,

    /** A video clip, played with the system's player. */
    Video,

    /** Word, Excel and PowerPoint documents and CSV / TSV tables, drawn as a page ([DocumentPreview]). */
    Document,
    Unsupported,
    ;

    companion object {
        /** Decided by extension first; anything else is text when its content decodes as text. */
        fun of(name: String, mimeType: String, data: ByteArray): FilePreviewKind =
            when (FileNames.extensionOf(name)) {
                "md", "markdown", "mdx" -> Markdown
                "html", "htm", "xhtml" -> Html
                in DocumentPreview.EXTENSIONS -> Document
                "gif", "svg" -> WebImage
                "pdf" -> Pdf
                "mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "amr" -> Audio
                "mp4", "m4v", "mov", "webm", "3gp", "mkv" -> Video
                "png", "jpg", "jpeg", "webp", "bmp", "heic", "heif", "ico" -> Image
                // A scaled-down photo arrives as JPEG whatever its extension was.
                else ->
                    when {
                        mimeType == "image/svg+xml" || mimeType == "image/gif" -> WebImage
                        mimeType == "application/pdf" -> Pdf
                        mimeType.startsWith("image/") -> Image
                        FileText.decode(data) != null -> Text
                        else -> Unsupported
                    }
            }
    }
}

/** What kind of file a name suggests, for the icon beside it in a listing. */
enum class FileCategory { Text, Web, Image, Pdf, Sheet, Slides, Document, Audio, Video, Archive, Code }

object FileNames {
    /** By extension; anything unrecognised is taken for code, as the working folder mostly holds. */
    fun category(name: String): FileCategory =
        when (extensionOf(name)) {
            "md", "markdown", "mdx", "txt", "log", "rtf" -> FileCategory.Text
            "html", "htm", "xhtml" -> FileCategory.Web
            "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "svg", "bmp", "tif", "tiff", "ico" -> FileCategory.Image
            "pdf" -> FileCategory.Pdf
            "csv", "tsv", "xls", "xlsx", "xlsm", "numbers" -> FileCategory.Sheet
            "ppt", "pptx", "pptm", "key" -> FileCategory.Slides
            "doc", "docx", "docm", "pages", "odt" -> FileCategory.Document
            "mp3", "m4a", "aac", "wav", "ogg", "opus", "flac" -> FileCategory.Audio
            "mp4", "m4v", "mov", "webm", "mkv" -> FileCategory.Video
            "zip", "gz", "tgz", "7z", "rar", "tar" -> FileCategory.Archive
            else -> FileCategory.Code
        }

    /** Lower-cased, without the dot; empty when there is none. */
    fun extensionOf(name: String): String = name.substringAfterLast('.', "").lowercase()

    /** The last path component, or `root` (the working directory's own name) for the directory itself. */
    fun title(ofDirectory: String, root: String): String = ofDirectory.split('/').lastOrNull { it.isNotEmpty() } ?: root

    /** The folder above `path`, "" being the working directory. */
    fun parent(path: String): String = path.trimEnd('/').substringBeforeLast('/', "")

    /**
     * The name a fetched file is handed to other apps under: a photo the desktop scaled
     * down is a JPEG whatever it was called, and a name never reaches outside its folder.
     */
    fun exportName(name: String, mimeType: String): String {
        val base = name.replace('/', '_').replace('\\', '_').takeUnless { it.isBlank() || it == "." || it == ".." } ?: "file"
        if (mimeType != "image/jpeg" || extensionOf(base) in setOf("jpg", "jpeg")) return base
        return base.substringBeforeLast('.', base) + ".jpg"
    }
}

object FileText {
    /** The content as text when it is UTF-8 without NUL bytes; binary otherwise. */
    fun decode(data: ByteArray): String? {
        if (data.take(8192).any { it == 0.toByte() }) return null
        return runCatching { Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(data)).toString() }.getOrNull()
    }

    /**
     * Text cut into pieces of whole lines for a lazy list, so only what is on screen is laid
     * out; an overlong line is cut too, since one line can be the whole file (minified code).
     */
    fun chunks(text: String, lines: Int = 40, maxChars: Int = 4000): List<String> {
        val result = ArrayList<String>()
        var start = 0
        var count = 0
        var i = 0
        while (i < text.length) {
            val newline = text[i] == '\n'
            if (newline) count++
            if (count == lines || i - start + 1 >= maxChars) {
                // The line break closing a piece is dropped: the next piece starts on a line of its own.
                result += text.substring(start, if (newline) i else i + 1)
                start = i + 1
                count = 0
            }
            i++
        }
        if (start < text.length || result.isEmpty()) result += text.substring(start)
        return result
    }
}

/** Why a file cannot be shown, in terms the phone can explain. */
enum class FileViewError {
    /** The desktop predates file viewing. */
    UnsupportedDesktop,
    Offline,

    /** Outside what the phone may read, or in a sensitive location. */
    Forbidden,
    NotFound,
    TooLarge,

    /** A folder where a file was expected. */
    NotAFile,
    Failed,
    ;

    /** Whether trying again may help: a dropped connection or a failed read, not a refusal. */
    val retryable: Boolean get() = this == Offline || this == Failed

    companion object {
        fun from(error: Throwable): FileViewError =
            when (error) {
                is FileViewException -> error.reason
                is LinkOfflineException -> Offline
                is RemoteRequestException ->
                    when (error.remoteError.code) {
                        RemoteErrorCode.Forbidden -> Forbidden
                        RemoteErrorCode.NotFound -> NotFound
                        RemoteErrorCode.TooLarge -> TooLarge
                        RemoteErrorCode.TransportClosed, RemoteErrorCode.RequestTimeout -> Offline
                        else -> Failed
                    }
                else -> Failed
            }
    }
}

class FileViewException(val reason: FileViewError) : Exception(reason.name)

/** A whole file as it arrived: the bytes the desktop sent and their type. */
class FileContent(val data: ByteArray, val mimeType: String, val modifiedAt: Double)

/** Fetches a file chunk by chunk with `file.read`, starting over when the desktop reports it changed mid-read. */
object RemoteFileReader {
    /** Largest file the phone may preview, the desktop's own preview limit. */
    const val MAX_FILE_BYTES = 10 * 1024 * 1024

    /**
     * Bytes one chunk may carry on a channel, null for the desktop's own size. A WebRTC
     * data channel drops any message over 256 KiB, and base64 twice over (the chunk, then
     * the sealed frame) makes a chunk 16/9 of its size on the wire.
     */
    fun chunkBytes(channel: LinkChannel?): Int? = if (channel == LinkChannel.P2p) 128 * 1024 else null

    /** `chunkBytes` is asked before every chunk, since the link can change channel mid-read. */
    suspend fun read(path: String, chunkBytes: () -> Int?, request: suspend (JsonObject) -> JsonElement?): FileContent {
        var attempts = 0
        while (true) {
            attempts += 1
            try {
                return readOnce(path, chunkBytes, request)
            } catch (error: RemoteRequestException) {
                if (error.remoteError.code != RemoteErrorCode.FileChanged || attempts >= 3) throw error
            }
        }
    }

    private suspend fun readOnce(path: String, chunkBytes: () -> Int?, request: suspend (JsonObject) -> JsonElement?): FileContent {
        val data = java.io.ByteArrayOutputStream()
        var total = -1
        var mimeType = "application/octet-stream"
        var modifiedAt = 0.0
        do {
            val payload =
                buildJsonObject {
                    put("path", path)
                    put("offset", data.size())
                    if (total >= 0) put("modifiedAt", modifiedAt)
                    chunkBytes()?.let { put("length", it) }
                }
            val chunk = RemoteApi.readFileChunk(request(payload))
            if (chunk == null || chunk.offset != data.size().toLong()) throw FileViewException(FileViewError.Failed)
            if (total < 0) {
                if (chunk.totalSize > MAX_FILE_BYTES) throw FileViewException(FileViewError.TooLarge)
                total = chunk.totalSize.toInt()
                mimeType = chunk.mimeType
                modifiedAt = chunk.modifiedAt
            }
            // An empty chunk before the end would loop forever.
            if (chunk.data.isEmpty() && data.size() < total) throw FileViewException(FileViewError.Failed)
            data.write(chunk.data)
        } while (data.size() < total)
        return FileContent(data.toByteArray(), mimeType, modifiedAt)
    }
}

/**
 * Files already fetched this launch, so opening one again costs nothing while it is
 * unchanged. Keyed by the file's size and modification time as well, so a rewritten file
 * is fetched afresh. Bounded by bytes, oldest dropped first.
 */
class FileContentCache(private val budget: Int = 48 * 1024 * 1024) {
    private val entries = LinkedHashMap<String, FileContent>(16, 0.75f, true)
    private var bytes = 0

    private fun key(sessionId: String, info: RemoteFileInfo) = "$sessionId\u0000${info.path}\u0000${info.modifiedAt}\u0000${info.size}"

    fun get(sessionId: String, info: RemoteFileInfo): FileContent? = entries[key(sessionId, info)]

    fun put(sessionId: String, info: RemoteFileInfo, content: FileContent) {
        entries.put(key(sessionId, info), content)?.let { bytes -= it.data.size }
        bytes += content.data.size
        val iterator = entries.entries.iterator()
        while (bytes > budget && entries.size > 1 && iterator.hasNext()) {
            bytes -= iterator.next().value.data.size
            iterator.remove()
        }
    }

    fun clear() {
        entries.clear()
        bytes = 0
    }
}
