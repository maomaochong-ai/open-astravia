package org.vetta.android.domain.remote.connection

import android.util.Log

actual object PlatformRemoteLogger : RemoteLogger {
    override fun debug(message: String, fields: Map<String, Any?>) {
        runCatching { Log.d(TAG, format(message, fields)) }
    }

    override fun info(message: String, fields: Map<String, Any?>) {
        runCatching { Log.i(TAG, format(message, fields)) }
    }

    override fun warn(message: String, fields: Map<String, Any?>) {
        runCatching { Log.w(TAG, format(message, fields)) }
    }

    private fun format(message: String, fields: Map<String, Any?>): String =
        if (fields.isEmpty()) message else "$message ${fields.entries.joinToString { "${it.key}=${it.value}" }}"

    private const val TAG = "VettaRemote"
}
