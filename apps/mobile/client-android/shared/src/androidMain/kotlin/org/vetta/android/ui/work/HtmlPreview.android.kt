package org.vetta.android.ui.work

import android.content.ActivityNotFoundException
import android.content.Intent
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.viewinterop.AndroidView

@Composable
actual fun HtmlPreview(html: String, modifier: Modifier, zoomable: Boolean) {
    // Loaded once per page, so recomposing does not reload it and lose the scroll.
    key(html) {
        AndroidView(
            modifier = modifier.testTag("files.html"),
            factory = { context ->
                WebView(context).apply {
                    // A static look at the page: no scripts, nothing fetched, no file access.
                    settings.javaScriptEnabled = false
                    settings.blockNetworkLoads = true
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    if (zoomable) {
                        settings.setSupportZoom(true)
                        settings.builtInZoomControls = true
                        settings.displayZoomControls = false
                    }
                    webViewClient = LinksLeave
                    loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
                }
            },
            onRelease = WebView::destroy,
        )
    }
}

/** A page never navigates away: web and mail links open in their own apps, anything else goes nowhere. */
private object LinksLeave : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url
        if (url.scheme?.lowercase() in setOf("http", "https", "mailto")) {
            try {
                view.context.startActivity(Intent(Intent.ACTION_VIEW, url))
            } catch (_: ActivityNotFoundException) {
                // Nothing on the phone handles it; the tap does nothing.
            }
        }
        return true
    }
}
