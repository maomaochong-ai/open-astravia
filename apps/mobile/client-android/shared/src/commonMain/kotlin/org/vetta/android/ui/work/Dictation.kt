package org.vetta.android.ui.work

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable

enum class DictationFailure {
    Denied,
    Unavailable,
}

/**
 * Hold-to-talk dictation for the composer: the live transcript and input level
 * while the finger is down, the final text when it lifts.
 */
@Stable
interface Dictation {
    val listening: Boolean
    val transcript: String

    /** Input loudness, 0..1, for the glow. */
    val level: Float

    /** Starts listening; asks for the microphone the first time. Null once it is listening. */
    suspend fun start(): DictationFailure?

    /** Stops listening and returns what was heard, waiting briefly for the final result. */
    suspend fun stop(): String

    fun cancel()
}

@Composable
expect fun rememberDictation(): Dictation

/**
 * The cue for dictation starting, played the moment the hold registers: a short soft
 * tone (silent when the phone is on silent or vibrate) with a vibration in the same rhythm
 * as the iPhone's: a light tick, a firm tap, then a hum that fades out.
 */
@Composable
expect fun rememberDictationCue(): () -> Unit
