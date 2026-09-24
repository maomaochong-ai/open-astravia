package org.vetta.android.ui.work

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

@Composable
actual fun rememberDictation(): Dictation {
    val context = LocalContext.current
    val dictation = remember(context) { AndroidDictation(context) }
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            dictation.permissionAnswered(granted)
        }
    SideEffect { dictation.requestPermission = { permission.launch(Manifest.permission.RECORD_AUDIO) } }
    DisposableEffect(dictation) { onDispose { dictation.cancel() } }
    return dictation
}

/**
 * [Dictation] on the system speech recognizer, in the phone's language and on
 * the device when it can. Used from the main thread only, as SpeechRecognizer requires.
 */
private class AndroidDictation(private val context: Context) : Dictation {
    override var listening by mutableStateOf(false)
        private set
    override var transcript by mutableStateOf("")
        private set
    override var level by mutableFloatStateOf(0f)
        private set

    var requestPermission: () -> Unit = {}
    private var permissionAnswer: CompletableDeferred<Boolean>? = null
    private var recognizer: SpeechRecognizer? = null
    private var finalResult: CompletableDeferred<Unit>? = null

    fun permissionAnswered(granted: Boolean) {
        permissionAnswer?.complete(granted)
    }

    override suspend fun start(): DictationFailure? {
        transcript = ""
        level = 0f
        listening = true
        if (!granted()) {
            val answer = CompletableDeferred<Boolean>().also { permissionAnswer = it }
            requestPermission()
            val allowed = answer.await()
            permissionAnswer = null
            if (!allowed) {
                listening = false
                return DictationFailure.Denied
            }
            // Let go while the permission prompt was up: nothing to listen for any more.
            if (!listening) return null
        }
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            listening = false
            return DictationFailure.Unavailable
        }
        val next = SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = next
        finalResult = CompletableDeferred()
        next.setRecognitionListener(Listener())
        next.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            },
        )
        return null
    }

    override suspend fun stop(): String {
        if (!listening) return transcript
        recognizer?.stopListening()
        // The recognizer delivers its final result shortly after it stops hearing audio.
        finalResult?.let { withTimeoutOrNull(FINAL_WAIT_MS) { it.await() } }
        release()
        return transcript
    }

    override fun cancel() {
        release()
        transcript = ""
    }

    private fun release() {
        recognizer?.cancel()
        recognizer?.destroy()
        recognizer = null
        finalResult = null
        permissionAnswer?.complete(false)
        listening = false
        level = 0f
    }

    private fun granted(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private inner class Listener : RecognitionListener {
        override fun onPartialResults(partialResults: Bundle?) {
            best(partialResults)?.let { transcript = it }
        }

        override fun onResults(results: Bundle?) {
            best(results)?.let { transcript = it }
            finalResult?.complete(Unit)
        }

        override fun onError(error: Int) {
            finalResult?.complete(Unit)
        }

        // Speech sits around -2..10 dB here; map that range onto 0..1.
        override fun onRmsChanged(rmsdB: Float) {
            level = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
        }

        override fun onReadyForSpeech(params: Bundle?) = Unit

        override fun onBeginningOfSpeech() = Unit

        override fun onBufferReceived(buffer: ByteArray?) = Unit

        override fun onEndOfSpeech() = Unit

        override fun onEvent(eventType: Int, params: Bundle?) = Unit

        private fun best(bundle: Bundle?): String? =
            bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() }
    }

    private companion object {
        const val FINAL_WAIT_MS = 800L
    }
}
