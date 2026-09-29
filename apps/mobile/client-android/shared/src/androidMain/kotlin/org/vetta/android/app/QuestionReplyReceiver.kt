package org.vetta.android.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.vetta.android.domain.work.QuickReply

/**
 * Answers the desktop's question from a notification's button or typed reply, without
 * opening the app. The question must still be the one waiting: an answer to one already
 * settled elsewhere is not sent, and the notification then leads into the app instead.
 */
class QuestionReplyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val sessionId = intent.getStringExtra(SessionNotifier.EXTRA_SESSION_ID) ?: return
        val requestId = intent.getStringExtra(EXTRA_REQUEST_ID) ?: return
        val reply =
            intent.getStringExtra(EXTRA_ANSWER)
                ?: RemoteInput.getResultsFromIntent(intent)?.getCharSequence(SessionNotifier.KEY_REPLY)?.toString()
                ?: return
        val container = AndroidAppContainer.get(context)
        val pending = goAsync()
        container.scope.launch {
            try {
                val mirror = container.mirror
                val state = mirror.state.value
                val question = state.transcript(sessionId).pendingQuestion?.takeIf { it.requestId == requestId }
                val answers = question?.let { QuickReply.answer(it, reply) }
                // A broadcast has about ten seconds; leave room to update the notification.
                val delivered = answers != null && withTimeoutOrNull(SEND_TIMEOUT_MS) { mirror.respond(sessionId, requestId, answers) } == true
                SessionNotifier.replied(context, sessionId, state.session(sessionId)?.title.orEmpty(), delivered)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val EXTRA_REQUEST_ID = "org.vetta.android.extra.REQUEST_ID"
        const val EXTRA_ANSWER = "org.vetta.android.extra.ANSWER"
        private const val SEND_TIMEOUT_MS = 8_000L
    }
}
